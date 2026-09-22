[CmdletBinding()]
param(
  [string]$Repository = "iamprateeknk-pixel/invexaretail",
  [string]$DefaultP0Owner = "Prateek Choudhary",
  [hashtable]$RiskOwners = @{},
  [hashtable]$GitHubAssignees = @{}
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Invoke-GhJson {
  param([Parameter(Mandatory)][string[]]$Arguments)

  $output = & gh @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "GitHub CLI failed: gh $($Arguments -join ' ')"
  }
  if ([string]::IsNullOrWhiteSpace(($output -join "`n"))) {
    return $null
  }
  return ($output -join "`n") | ConvertFrom-Json
}

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
  throw "GitHub CLI is not installed."
}

& gh auth status *> $null
if ($LASTEXITCODE -ne 0) {
  throw "GitHub CLI is not authenticated. Run 'gh auth login', then rerun this script."
}

$null = Invoke-GhJson -Arguments @("repo", "view", $Repository, "--json", "nameWithOwner")

$milestoneTitle = "Week 1 - Containment and Recovery"
$milestoneDescription = "Containment gate: reproducible audited baseline, risk ownership, isolated restore evidence, and deployment-path decisions. Week 2 remains blocked until all P0 risks have named owners and the staging restore succeeds."

$milestones = @(Invoke-GhJson -Arguments @("api", "repos/$Repository/milestones?state=all&per_page=100"))
$milestone = $milestones | Where-Object { $_.title -eq $milestoneTitle } | Select-Object -First 1
if (-not $milestone) {
  $milestone = Invoke-GhJson -Arguments @(
    "api", "--method", "POST", "repos/$Repository/milestones",
    "-f", "title=$milestoneTitle",
    "-f", "description=$milestoneDescription"
  )
  Write-Host "Created milestone: $milestoneTitle"
} else {
  Write-Host "Milestone already exists: $milestoneTitle"
}

$labels = @(
  @{ Name = "risk"; Color = "B60205"; Description = "Audit or release risk" },
  @{ Name = "week-1"; Color = "1D76DB"; Description = "Week 1 containment work" },
  @{ Name = "priority:P0"; Color = "D73A4A"; Description = "Release-blocking priority" },
  @{ Name = "priority:P1"; Color = "FBCA04"; Description = "High priority" },
  @{ Name = "owner-required"; Color = "5319E7"; Description = "Accountable owner has not been assigned" }
)

foreach ($label in $labels) {
  & gh label create $label.Name --repo $Repository --color $label.Color --description $label.Description --force | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "Unable to create or update label '$($label.Name)'."
  }
}

$risks = @(
  @{ Id = "R1"; Name = "Multiple stock truths"; Priority = "P0"; Week = "6"; Evidence = "Canonical journal equals balance projection for golden data"; Recovery = "Rebuild projection from immutable journal" },
  @{ Id = "R2"; Name = "Weak refresh lifecycle"; Priority = "P0"; Week = "3"; Evidence = "Rotation, replay, revoke-all and restart tests pass"; Recovery = "Revoke session families and force re-authentication" },
  @{ Id = "R3"; Name = "Cross-tenant query gaps"; Priority = "P0"; Week = "4"; Evidence = "Overlapping-ID negative isolation suite passes"; Recovery = "Disable affected route and investigate audit trail" },
  @{ Id = "R4"; Name = "Hybrid memory and database state"; Priority = "P1"; Week = "6-8"; Evidence = "Durable state survives API and worker restart"; Recovery = "Drain/replay durable outbox and rebuild projections" },
  @{ Id = "R5"; Name = "Non-atomic reservations"; Priority = "P0"; Week = "7"; Evidence = "Oversubscription and duplicate-transition concurrency tests pass"; Recovery = "Compensate reservation through canonical service" },
  @{ Id = "R6"; Name = "Float precision"; Priority = "P0"; Week = "5"; Evidence = "Decimal migration reconciliation with approved rounding deltas"; Recovery = "Restore backup or run approved compensating reconciliation" },
  @{ Id = "R7"; Name = "Runtime DDL and migration drift"; Priority = "P0"; Week = "5"; Evidence = "Fresh, upgrade, restored, and rollback databases converge"; Recovery = "Restore backup and execute tested migration rollback" },
  @{ Id = "R8"; Name = "Mobile fake SQLite and secret storage"; Priority = "P1"; Week = "16"; Evidence = "Offline process-death, duplicate-sync and secure-storage evidence"; Recovery = "Disable affected mobile release channel" },
  @{ Id = "R9"; Name = "Public DB fallback or brittle config"; Priority = "P0"; Week = "3"; Evidence = "Config scan and production startup fail-closed tests pass"; Recovery = "Rotate exposed credentials and disable unsafe deployment" },
  @{ Id = "R10"; Name = "No browser E2E gate"; Priority = "P1"; Week = "10"; Evidence = "Golden browser journeys run in staging"; Recovery = "Block release until manual validated fallback is approved" },
  @{ Id = "R11"; Name = "God routers and components"; Priority = "P1"; Week = "8-9"; Evidence = "Module boundaries and focused ownership tests pass"; Recovery = "Revert isolated refactor commit" },
  @{ Id = "R12"; Name = "Polling plus SSE scaling"; Priority = "P1"; Week = "10"; Evidence = "Load and reconnect behavior meets approved budget"; Recovery = "Degrade to bounded polling with monitoring" },
  @{ Id = "R13"; Name = "Upload boundary"; Priority = "P1"; Week = "11,13"; Evidence = "Spoofed, oversized, and malicious input is rejected"; Recovery = "Quarantine objects and revoke signed access" },
  @{ Id = "R14"; Name = "Deployment path drift"; Priority = "P0"; Week = "1,8"; Evidence = "Canonical staging deployment and restore both succeed"; Recovery = "Roll back to prior tagged artifact and restore data" },
  @{ Id = "R15"; Name = "Documentation drift"; Priority = "P1"; Week = "18"; Evidence = "Clean-developer setup and runbook rehearsal pass"; Recovery = "Correct documentation before release" }
)

$existingIssues = @(Invoke-GhJson -Arguments @(
  "issue", "list", "--repo", $Repository, "--state", "all", "--limit", "200",
  "--json", "number,title,url"
))

$created = 0
$existing = 0
foreach ($risk in $risks) {
  $title = "[RISK] $($risk.Id) - $($risk.Name)"
  $match = $existingIssues | Where-Object { $_.title -eq $title } | Select-Object -First 1
  if ($match) {
    Write-Host "Exists #$($match.number): $title"
    $existing++
    continue
  }

  $owner = if ($RiskOwners.ContainsKey($risk.Id) -and -not [string]::IsNullOrWhiteSpace([string]$RiskOwners[$risk.Id])) {
    [string]$RiskOwners[$risk.Id]
  } elseif ($risk.Priority -eq "P0" -and -not [string]::IsNullOrWhiteSpace($DefaultP0Owner)) {
    $DefaultP0Owner
  } else {
    "Unassigned - Week 1 gate blocker"
  }

  $body = @"
## Risk record

- Priority: $($risk.Priority)
- Target week: $($risk.Week)
- Accountable owner: $owner
- Acceptance evidence: $($risk.Evidence)
- Rollback or recovery: $($risk.Recovery)

## Completion checklist

- [ ] Confirm a named accountable owner
- [ ] Link implementation pull request(s)
- [ ] Attach sanitized acceptance evidence
- [ ] Execute and record rollback or recovery rehearsal
- [ ] Update docs/release-evidence/week-01-containment/risk-register.md

Source: Week 1 audit risk register at audited commit 57eb95044cf98cde505eb0c4702e94b61643cd04.
"@

  $issueArgs = @(
    "issue", "create", "--repo", $Repository,
    "--title", $title,
    "--body", $body,
    "--milestone", $milestoneTitle,
    "--label", "risk",
    "--label", "week-1",
    "--label", "priority:$($risk.Priority)"
  )
  if ($owner -eq "Unassigned - Week 1 gate blocker") {
    $issueArgs += @("--label", "owner-required")
  }
  if ($GitHubAssignees.ContainsKey($risk.Id) -and -not [string]::IsNullOrWhiteSpace([string]$GitHubAssignees[$risk.Id])) {
    $issueArgs += @("--assignee", [string]$GitHubAssignees[$risk.Id])
  }

  $issueUrl = & gh @issueArgs
  if ($LASTEXITCODE -ne 0) {
    throw "Unable to create issue '$title'."
  }
  Write-Host "Created: $issueUrl"
  $created++
}

Write-Host "Governance setup complete. Created $created issue(s); retained $existing existing issue(s)."
Write-Host "Milestone: $($milestone.html_url)"
