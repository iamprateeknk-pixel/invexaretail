import { useState } from 'react'
import { usePasskeys } from '@/hooks/usePasskeys'
import { passkeysSupported } from '../../lib/passkeys'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { LoadingState } from '@/components/ui/feedback-states'

const formatDate = (value) => (value ? new Date(value).toLocaleDateString() : 'never')

// Account security: sign in with a fingerprint, face or screen lock instead of a password. A passkey stays on the
// device (or the user's password manager); only its public half is stored on the server.
export function PasskeyPanel({ authToken, webauthn, supported = passkeysSupported() }) {
  const { state, busy, error, add, remove } = usePasskeys({ authToken, webauthn });
  const [deviceName, setDeviceName] = useState('');

  if (!state) return error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : <LoadingState label="Loading passkeys…" />;

  const submit = async () => {
    if (await add(deviceName.trim())) setDeviceName('');
  };

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">Passkeys</CardTitle>
        <Badge variant={state.passkeys.length ? 'default' : 'secondary'}>{state.passkeys.length ? `${state.passkeys.length} saved` : 'None'}</Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        {!state.configured && <p className="text-sm text-muted-foreground">Passkeys are not enabled on this server yet. Ask whoever runs the server to set them up.</p>}
        {state.configured && !supported && <p className="text-sm text-muted-foreground">This browser or device does not support passkeys.</p>}

        {state.passkeys.length > 0 && (
          <ul className="space-y-2" aria-label="Your passkeys">
            {state.passkeys.map((passkey) => (
              <li key={passkey.id} className="flex items-center justify-between gap-3 rounded-md border p-2 text-sm">
                <span>
                  <span className="font-medium">{passkey.deviceName || 'Unnamed passkey'}</span>
                  <span className="block text-xs text-muted-foreground">Added {formatDate(passkey.createdAt)} · last used {formatDate(passkey.lastUsedAt)}</span>
                </span>
                <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => remove(passkey.id)}
                  aria-label={`Remove passkey ${passkey.deviceName || 'Unnamed passkey'}`}>
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}

        {state.configured && supported && (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">Sign in with your fingerprint, face or screen lock — no password to type or steal.</p>
            <div className="grid gap-2">
              <Label htmlFor="passkey-name">Name this device (optional)</Label>
              <Input id="passkey-name" maxLength={80} value={deviceName} onChange={(event) => setDeviceName(event.target.value)} placeholder="Shop laptop" />
            </div>
            <Button type="button" disabled={busy} onClick={submit}>Add a passkey</Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
