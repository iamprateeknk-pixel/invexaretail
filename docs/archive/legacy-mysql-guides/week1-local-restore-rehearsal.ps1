[CmdletBinding()]
param(
    [string]$InputSql,
    [string]$OutputDirectory,
    [switch]$KeepContainers
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if (-not $InputSql) {
    $InputSql = Join-Path $repositoryRoot 'invexaretail-database.sql'
}
if (-not $OutputDirectory) {
    $OutputDirectory = Join-Path $repositoryRoot 'docs/release-evidence/week-01-containment/local-restore-run'
}

$resolvedInput = (Resolve-Path -LiteralPath $InputSql).Path
if (-not $resolvedInput.StartsWith($repositoryRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'The rehearsal accepts only a SQL input stored inside this repository.'
}
if ([System.IO.Path]::GetExtension($resolvedInput) -ne '.sql') {
    throw 'The rehearsal input must be a .sql file.'
}

& docker info --format '{{.ServerVersion}}' | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw 'Docker is not healthy. Start Docker Desktop and retry.'
}

New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
$resolvedOutput = [System.IO.Path]::GetFullPath($OutputDirectory)
$runId = '{0}-{1}' -f (Get-Date -Format 'yyyyMMddHHmmss'), ([guid]::NewGuid().ToString('N').Substring(0, 8))
$workDirectory = Join-Path ([System.IO.Path]::GetTempPath()) "invexa-week1-restore-$runId"
New-Item -ItemType Directory -Path $workDirectory | Out-Null
$networkName = "invexa-week1-$runId"
$sourceContainer = "invexa-week1-source-$runId"
$targetContainer = "invexa-week1-target-$runId"
$sourceDatabase = 'invexa_source'
$targetDatabase = 'invexa_restore'
$passwordBytes = New-Object byte[] 24
[System.Security.Cryptography.RandomNumberGenerator]::Fill($passwordBytes)
$rootPassword = [Convert]::ToBase64String($passwordBytes).Replace('+', 'A').Replace('/', 'B').TrimEnd('=')
$startedAt = [DateTimeOffset]::UtcNow
$backupPath = Join-Path $workDirectory 'backup.sql'
$sourceSchemaPath = Join-Path $workDirectory 'source-schema.sql'
$targetSchemaPath = Join-Path $workDirectory 'target-schema.sql'

function Invoke-Docker {
    param([Parameter(Mandatory)][string[]]$Arguments)
    & docker @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Docker command failed: docker $($Arguments -join ' ')"
    }
}

function Wait-ForMysql {
    param([Parameter(Mandatory)][string]$Container)
    for ($attempt = 1; $attempt -le 40; $attempt++) {
        & docker exec -e "MYSQL_PWD=$rootPassword" $Container mysqladmin ping -h 127.0.0.1 -uroot --silent 2>$null
        if ($LASTEXITCODE -eq 0) {
            return
        }
        Start-Sleep -Seconds 2
    }
    throw "MySQL did not become ready in container $Container."
}

function Get-NormalizedSchemaHash {
    param([Parameter(Mandatory)][string]$Path)
    $schemaText = Get-Content -Raw -LiteralPath $Path
    # MySQL may expand an inherited table charset into the equivalent explicit
    # per-column form after restore. Normalize that non-semantic rewrite while
    # preserving every type, collation, key, default, and constraint.
    $schemaText = $schemaText -replace ' CHARACTER SET utf8mb4(?= COLLATE utf8mb4_unicode_ci)', ''
    $schemaText = $schemaText -replace "`r`n", "`n"
    $schemaBytes = [System.Text.Encoding]::UTF8.GetBytes($schemaText)
    $schemaStream = [System.IO.MemoryStream]::new($schemaBytes)
    try {
        return (Get-FileHash -InputStream $schemaStream -Algorithm SHA256).Hash
    }
    finally {
        $schemaStream.Dispose()
    }
}

try {
    Invoke-Docker @('network', 'create', $networkName)
    Invoke-Docker @(
        'run', '--detach', '--name', $sourceContainer, '--network', $networkName,
        '-e', "MYSQL_ROOT_PASSWORD=$rootPassword", '-e', "MYSQL_DATABASE=$sourceDatabase",
        'mysql:8.4'
    )
    Invoke-Docker @(
        'run', '--detach', '--name', $targetContainer, '--network', $networkName,
        '-e', "MYSQL_ROOT_PASSWORD=$rootPassword", '-e', "MYSQL_DATABASE=$targetDatabase",
        'mysql:8.4'
    )

    Wait-ForMysql $sourceContainer
    Wait-ForMysql $targetContainer

    Invoke-Docker @('cp', $resolvedInput, "${sourceContainer}:/tmp/input.sql")
    Invoke-Docker @('exec', '-e', "MYSQL_PWD=$rootPassword", $sourceContainer, 'sh', '-c', "mysql -uroot $sourceDatabase < /tmp/input.sql")

    Invoke-Docker @('exec', '-e', "MYSQL_PWD=$rootPassword", $sourceContainer, 'sh', '-c', "mysqldump --skip-comments --single-transaction --routines --events -uroot $sourceDatabase > /tmp/backup.sql")
    Invoke-Docker @('exec', '-e', "MYSQL_PWD=$rootPassword", $sourceContainer, 'sh', '-c', "mysqldump --skip-comments --no-data -uroot $sourceDatabase > /tmp/source-schema.sql")
    Invoke-Docker @('cp', "${sourceContainer}:/tmp/backup.sql", $backupPath)
    Invoke-Docker @('cp', "${sourceContainer}:/tmp/source-schema.sql", $sourceSchemaPath)

    Invoke-Docker @('cp', $backupPath, "${targetContainer}:/tmp/backup.sql")
    Invoke-Docker @('exec', '-e', "MYSQL_PWD=$rootPassword", $targetContainer, 'sh', '-c', "mysql -uroot $targetDatabase < /tmp/backup.sql")
    Invoke-Docker @('exec', '-e', "MYSQL_PWD=$rootPassword", $targetContainer, 'sh', '-c', "mysqldump --skip-comments --no-data -uroot $targetDatabase > /tmp/target-schema.sql")
    Invoke-Docker @('cp', "${targetContainer}:/tmp/target-schema.sql", $targetSchemaPath)

    $tableQuery = "SELECT table_name FROM information_schema.tables WHERE table_schema='$sourceDatabase' AND table_type='BASE TABLE' ORDER BY table_name;"
    $tables = @(& docker exec -e "MYSQL_PWD=$rootPassword" $sourceContainer mysql -N -B -uroot -e $tableQuery)
    if ($LASTEXITCODE -ne 0 -or $tables.Count -eq 0) {
        throw 'No source tables were available for row-count reconciliation.'
    }

    $rowCounts = foreach ($table in $tables) {
        if ($table -notmatch '^[A-Za-z0-9_]+$') {
            throw "Unsafe table identifier returned by MySQL: $table"
        }
        $countQuery = "SELECT COUNT(*) FROM ``$table``;"
        $sourceCount = [int64](& docker exec -e "MYSQL_PWD=$rootPassword" $sourceContainer mysql -N -B -uroot $sourceDatabase -e $countQuery)
        if ($LASTEXITCODE -ne 0) { throw "Source count failed for $table." }
        $targetCount = [int64](& docker exec -e "MYSQL_PWD=$rootPassword" $targetContainer mysql -N -B -uroot $targetDatabase -e $countQuery)
        if ($LASTEXITCODE -ne 0) { throw "Target count failed for $table." }
        [pscustomobject]@{
            Table = $table
            SourceRows = $sourceCount
            RestoredRows = $targetCount
            Match = ($sourceCount -eq $targetCount)
        }
    }

    $rowCounts | Export-Csv -LiteralPath (Join-Path $resolvedOutput 'row-counts.csv') -NoTypeInformation
    $backupHash = (Get-FileHash -LiteralPath $backupPath -Algorithm SHA256).Hash
    $sourceSchemaRawHash = (Get-FileHash -LiteralPath $sourceSchemaPath -Algorithm SHA256).Hash
    $targetSchemaRawHash = (Get-FileHash -LiteralPath $targetSchemaPath -Algorithm SHA256).Hash
    $sourceSchemaHash = Get-NormalizedSchemaHash $sourceSchemaPath
    $targetSchemaHash = Get-NormalizedSchemaHash $targetSchemaPath
    $finishedAt = [DateTimeOffset]::UtcNow
    $summary = [ordered]@{
        RunId = $runId
        StartedAtUtc = $startedAt.ToString('O')
        FinishedAtUtc = $finishedAt.ToString('O')
        ElapsedSeconds = [math]::Round(($finishedAt - $startedAt).TotalSeconds, 3)
        InputSql = [System.IO.Path]::GetFileName($resolvedInput)
        InputSha256 = (Get-FileHash -LiteralPath $resolvedInput -Algorithm SHA256).Hash
        BackupSha256 = $backupHash
        SourceSchemaRawSha256 = $sourceSchemaRawHash
        RestoredSchemaRawSha256 = $targetSchemaRawHash
        SourceSchemaNormalizedSha256 = $sourceSchemaHash
        RestoredSchemaNormalizedSha256 = $targetSchemaHash
        SchemaMatch = ($sourceSchemaHash -eq $targetSchemaHash)
        TableCount = $rowCounts.Count
        RowCountsMatch = -not ($rowCounts.Match -contains $false)
        DockerImage = 'mysql:8.4'
    }
    $summary | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $resolvedOutput 'summary.json') -Encoding utf8

    if (-not $summary.SchemaMatch -or -not $summary.RowCountsMatch) {
        throw 'Restore reconciliation failed. Review the retained evidence files.'
    }

    Write-Output "Restore rehearsal passed. Evidence: $resolvedOutput"
}
finally {
    if (-not $KeepContainers) {
        foreach ($container in @($sourceContainer, $targetContainer)) {
            if ($container -match '^invexa-week1-(source|target)-[A-Za-z0-9-]+$') {
                & docker rm --force $container 2>$null | Out-Null
            }
        }
        if ($networkName -match '^invexa-week1-[A-Za-z0-9-]+$') {
            & docker network rm $networkName 2>$null | Out-Null
        }
    }
    $resolvedWork = [System.IO.Path]::GetFullPath($workDirectory)
    $tempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
    if ($resolvedWork.StartsWith($tempRoot, [System.StringComparison]::OrdinalIgnoreCase) -and
        [System.IO.Path]::GetFileName($resolvedWork) -match '^invexa-week1-restore-[0-9]{14}-[a-f0-9]{8}$') {
        Remove-Item -Recurse -Force -LiteralPath $resolvedWork -ErrorAction SilentlyContinue
    }
}
