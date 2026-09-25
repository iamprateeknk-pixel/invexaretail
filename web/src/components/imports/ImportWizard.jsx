import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { ErrorState } from '@/components/ui/feedback-states'
import { useStagedImport } from '@/hooks/useStagedImport'
import {
  IMPORT_TYPES, canCommit, canReverse, commitProgress, failuresToCsv, parseImportCsv, stepForStatus,
} from '@/lib/staged-import'

const STEPS = [
  { id: 'upload', label: '1. Choose file' },
  { id: 'validate', label: '2. Preview' },
  { id: 'confirm', label: '3. Confirm' },
  { id: 'progress', label: '4. Posting' },
  { id: 'result', label: '5. Result' },
]

function downloadCsv(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  URL.revokeObjectURL(url)
}

// Guide Week 11: preview -> validate -> stage -> commit -> reconcile -> reverse
// as one keyboard-operable wizard. Rows are parsed in the browser but validated,
// checksummed and posted by the server (through InventoryPostingService).
export function ImportWizard({ authToken }) {
  const flow = useStagedImport({ authToken })
  const [type, setType] = useState('PURCHASE')
  const [fileName, setFileName] = useState('')
  const [text, setText] = useState('')
  const [reason, setReason] = useState('')
  const parsed = useMemo(() => (text.trim() ? parseImportCsv(text) : null), [text])

  const step = flow.batch ? stepForStatus(flow.batch.status) : 'upload'
  const activeIndex = STEPS.findIndex((s) => s.id === (step === 'validate' ? 'validate' : step))
  const policy = IMPORT_TYPES.find((t) => t.value === type)?.policy
  const batchType = flow.batch?.type ?? type
  const gate = canCommit(flow.batch, batchType)
  const progress = commitProgress(flow.batch)

  const onFile = async (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    setFileName(file.name)
    setText(await file.text())
  }

  return (
    <div className="flex flex-col gap-4">
      <ol className="flex flex-wrap gap-2 text-xs" aria-label="Import steps">
        {STEPS.map((s, index) => (
          <li key={s.id} aria-current={index === activeIndex ? 'step' : undefined}
            className={index === activeIndex ? 'rounded-md bg-primary px-2 py-1 font-semibold text-primary-foreground' : 'rounded-md bg-muted px-2 py-1 text-muted-foreground'}>
            {s.label}
          </li>
        ))}
      </ol>

      {flow.error && <ErrorState description={flow.error} />}

      {!flow.batch && (
        <Card>
          <CardHeader><CardTitle className="text-sm">Choose what you are importing</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">Import type</span>
              <select className="h-9 rounded-md border bg-background px-2" value={type} onChange={(e) => setType(e.target.value)}>
                {IMPORT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </label>
            <p className="text-sm text-muted-foreground">{policy}</p>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">CSV file (itemCode, lotNo, quantity, branchName, transactionAt)</span>
              <input type="file" accept=".csv,text/csv" onChange={onFile} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">…or paste CSV text</span>
              <Textarea rows={6} value={text} onChange={(e) => { setText(e.target.value); if (!fileName) setFileName('pasted.csv') }} />
            </label>
            {parsed?.problems.length > 0 && (
              <ul role="alert" className="list-disc pl-5 text-sm text-destructive">
                {parsed.problems.map((p) => <li key={p}>{p}</li>)}
              </ul>
            )}
            {parsed && parsed.problems.length === 0 && (
              <p role="status" className="text-sm">{parsed.rows.length.toLocaleString()} row(s) ready to preview. Nothing is posted yet.</p>
            )}
            <div>
              <Button
                disabled={flow.busy || !parsed || parsed.problems.length > 0 || parsed.rows.length === 0}
                onClick={() => flow.stage({ type, fileName: fileName || 'pasted.csv', rows: parsed.rows })}
              >
                {flow.busy ? 'Checking…' : 'Preview and validate'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {flow.batch && (
        <Card>
          <CardHeader><CardTitle className="text-sm">{flow.batch.fileName} · {flow.batch.type}</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-3">
            {flow.duplicate && (
              <p role="status" className="text-sm">This exact file was already uploaded, so its existing batch is shown instead of creating a duplicate.</p>
            )}
            <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
              <div><dt className="text-muted-foreground">Status</dt><dd data-testid="batch-status" className="font-semibold">{flow.batch.status}</dd></div>
              <div><dt className="text-muted-foreground">Rows</dt><dd>{flow.batch.totalRows}</dd></div>
              <div><dt className="text-muted-foreground">Valid</dt><dd>{flow.batch.validRows}</dd></div>
              <div><dt className="text-muted-foreground">Invalid</dt><dd>{flow.batch.invalidRows}</dd></div>
            </dl>

            {(step === 'progress') && (
              <div>
                <div role="progressbar" aria-label="Posting progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.percent} className="h-2 w-full overflow-hidden rounded bg-muted">
                  <div className="h-full bg-primary" style={{ width: `${progress.percent}%` }} />
                </div>
                <p role="status" className="mt-1 text-sm">{progress.done.toLocaleString()} of {progress.total.toLocaleString()} rows posted. You can leave this page - posting continues on the server.</p>
              </div>
            )}

            {flow.failures.length > 0 && (
              <div className="flex flex-col gap-2">
                <p className="text-sm font-medium">{flow.failures.length} problem(s) found</p>
                <table className="w-full text-left text-sm">
                  <thead><tr><th scope="col">Row</th><th scope="col">Field</th><th scope="col">Problem</th></tr></thead>
                  <tbody>
                    {flow.failures.slice(0, 20).map((f, i) => (
                      <tr key={`${f.rowNumber}-${f.field}-${i}`}><td>{f.rowNumber}</td><td>{f.field}</td><td>{f.message}</td></tr>
                    ))}
                  </tbody>
                </table>
                {flow.failures.length > 20 && <p className="text-xs text-muted-foreground">Showing the first 20; download the full list.</p>}
                <div>
                  <Button variant="outline" size="sm" onClick={() => downloadCsv(`failed-rows-${flow.batch.id}.csv`, failuresToCsv(flow.failures))}>
                    Download failed rows (CSV)
                  </Button>
                </div>
              </div>
            )}

            {step === 'confirm' && (
              <div className="flex flex-col gap-2">
                {!gate.ok && <p role="alert" className="text-sm text-destructive">{gate.reason}</p>}
                <div className="flex gap-2">
                  <Button disabled={flow.busy || !gate.ok} onClick={flow.commit}>
                    {flow.busy ? 'Starting…' : `Post ${flow.batch.validRows} valid row(s)`}
                  </Button>
                  <Button variant="outline" onClick={flow.reset}>Start over</Button>
                </div>
              </div>
            )}

            {step === 'result' && (
              <div className="flex flex-col gap-2">
                {canReverse(flow.batch) && (
                  <div className="flex flex-wrap items-end gap-2">
                    <label className="flex flex-col gap-1 text-sm">
                      <span className="font-medium">Reason to reverse (optional)</span>
                      <input className="h-9 rounded-md border bg-background px-2" value={reason} onChange={(e) => setReason(e.target.value)} />
                    </label>
                    <Button variant="destructive" disabled={flow.busy} onClick={() => flow.reverse(reason)}>Reverse this import</Button>
                  </div>
                )}
                <div><Button variant="outline" onClick={flow.reset}>Import another file</Button></div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
