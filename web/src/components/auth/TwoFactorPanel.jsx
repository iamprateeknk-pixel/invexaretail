import { useState } from 'react'
import { useTwoFactor } from '@/hooks/useTwoFactor'
import { twoFactorCodeLooksValid } from '../../lib/two-factor'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { LoadingState } from '@/components/ui/feedback-states'
import { QrCode } from './QrCode'

// Account security: opt in to an authenticator-app code at sign-in. The
// authenticator is set up by scanning the QR code, or by typing the key.
export function TwoFactorPanel({ authToken }) {
  const { status, setup, backupCodes, busy, error, begin, enable, disable, dismissBackupCodes, cancelSetup } = useTwoFactor({ authToken });
  const [code, setCode] = useState('');

  if (!status) return error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : <LoadingState label="Loading security settings…" />;

  const submit = async (action) => {
    await action(code.trim());
    setCode('');
  };

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">Two-factor sign-in</CardTitle>
        <Badge variant={status.enabled ? 'default' : 'secondary'}>{status.enabled ? 'On' : 'Off'}</Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && <Alert variant="destructive"><AlertDescription role="alert">{error}</AlertDescription></Alert>}
        {!status.configured && <p className="text-sm text-muted-foreground">Two-factor sign-in is not enabled on this server yet. Ask whoever runs the server to set it up.</p>}

        {backupCodes && (
          <div className="space-y-2 rounded-md border bg-muted/40 p-3">
            <p className="text-sm font-medium">Save these backup codes now. Each works once, and they will not be shown again.</p>
            <ul className="grid grid-cols-2 gap-1 font-mono text-sm" aria-label="Backup codes">
              {backupCodes.map((backup) => <li key={backup}>{backup}</li>)}
            </ul>
            <Button type="button" size="sm" onClick={dismissBackupCodes}>I have saved them</Button>
          </div>
        )}

        {status.configured && !status.enabled && !setup && (
          <>
            <p className="text-sm text-muted-foreground">Add a code from an authenticator app (Google Authenticator, Authy, 1Password…) as a second step when you sign in.</p>
            <Button type="button" disabled={busy} onClick={begin}>Set up two-factor</Button>
          </>
        )}

        {setup && (
          <div className="space-y-3">
            <p className="text-sm">Scan this code with your authenticator app:</p>
            <QrCode value={setup.otpauthUri} label="QR code for your authenticator app" />
            <p className="text-sm">Or choose “Enter a setup key” in the app and type:</p>
            <p className="rounded-md bg-muted px-3 py-2 font-mono text-sm break-all" aria-label="Setup key">{setup.secret}</p>
            <a className="text-sm text-primary underline" href={setup.otpauthUri}>Open in authenticator app</a>
            <div className="grid gap-2">
              <Label htmlFor="tf-enable-code">Enter the 6-digit code it shows</Label>
              <Input id="tf-enable-code" inputMode="numeric" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))} />
            </div>
            <div className="flex gap-2">
              <Button type="button" disabled={busy || code.length !== 6} onClick={() => submit(enable)}>Turn on</Button>
              <Button type="button" variant="ghost" disabled={busy} onClick={cancelSetup}>Cancel</Button>
            </div>
          </div>
        )}

        {status.enabled && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">{status.backupCodesRemaining} backup code{status.backupCodesRemaining === 1 ? '' : 's'} left.</p>
            <div className="grid gap-2">
              <Label htmlFor="tf-disable-code">To turn it off, enter a current code or a backup code</Label>
              <Input id="tf-disable-code" value={code} onChange={(event) => setCode(event.target.value)} />
            </div>
            <Button type="button" variant="outline" disabled={busy || !twoFactorCodeLooksValid(code)} onClick={() => submit(disable)}>Turn off two-factor</Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
