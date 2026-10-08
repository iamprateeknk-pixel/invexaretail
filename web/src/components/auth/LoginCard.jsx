import { useState } from 'react';
import logoFull from '../../assets/logo-full.png';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Toaster } from '@/components/ui/sonner';
import { passkeysSupported } from '../../lib/passkeys';

export function LoginCard({
  loginEmail,
  setLoginEmail,
  loginPassword,
  setLoginPassword,
  loginOtp,
  setLoginOtp,
  otpSent,
  otpNotice,
  devOtpCode,
  authError,
  authLoading,
  onPasswordSubmit,
  onSendOtp,
  onVerifyOtp,
  twoFactorPending = false,
  twoFactorCode = '',
  setTwoFactorCode,
  onVerifyTwoFactor,
  onCancelTwoFactor,
  onPasskeySignIn,
  passkeysAvailable = passkeysSupported(),
}) {
  const [method, setMethod] = useState('password');

  if (twoFactorPending) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-muted/40 p-4">
        <Toaster richColors position="top-right" />
        <Card className="w-full max-w-sm">
          <CardHeader className="items-center gap-3 text-center">
            <img src={logoFull} alt="InvexaRetail" className="w-44 rounded-xl shadow-lg" />
            <CardTitle className="text-xl">Two-factor check</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={onVerifyTwoFactor} className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="login-2fa">Authenticator or backup code</Label>
                <Input
                  id="login-2fa"
                  autoFocus
                  autoComplete="one-time-code"
                  required
                  value={twoFactorCode}
                  onChange={(event) => setTwoFactorCode(event.target.value)}
                  placeholder="123456"
                />
                <p className="text-xs text-muted-foreground">Open your authenticator app and enter the 6-digit code, or use one of your backup codes.</p>
              </div>
              {authError && (
                <Alert variant="destructive">
                  <AlertDescription>{authError}</AlertDescription>
                </Alert>
              )}
              <Button type="submit" className="w-full" disabled={authLoading || !twoFactorCode.trim()}>
                {authLoading ? 'Verifying…' : 'Verify and sign in'}
              </Button>
              <Button type="button" variant="ghost" className="w-full" disabled={authLoading} onClick={onCancelTwoFactor}>
                Use a different account
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-svh items-center justify-center bg-muted/40 p-4">
      <Toaster richColors position="top-right" />
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center gap-3 text-center">
          <img src={logoFull} alt="InvexaRetail" className="w-44 rounded-xl shadow-lg" />
          <CardTitle className="text-xl">Sign in</CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs value={method} onValueChange={setMethod} className="gap-4">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger id="login-tab-password" value="password">
                Password
              </TabsTrigger>
              <TabsTrigger id="login-tab-otp" value="otp">
                One-time code
              </TabsTrigger>
            </TabsList>
            <TabsContent value="password">
              <form onSubmit={onPasswordSubmit} className="grid gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="login-email">Email</Label>
                  <Input
                    id="login-email"
                    type="email"
                    required
                    autoComplete="username"
                    value={loginEmail}
                    onChange={(event) => setLoginEmail(event.target.value)}
                    placeholder="admin@retail.local"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="login-password">Password</Label>
                  <Input
                    id="login-password"
                    type="password"
                    required
                    autoComplete="current-password"
                    value={loginPassword}
                    onChange={(event) => setLoginPassword(event.target.value)}
                  />
                </div>
                {authError && (
                  <Alert variant="destructive">
                    <AlertDescription>{authError}</AlertDescription>
                  </Alert>
                )}
                <Button type="submit" className="w-full" disabled={authLoading}>
                  {authLoading ? 'Signing in…' : 'Sign in'}
                </Button>
              </form>
            </TabsContent>
            <TabsContent value="otp">
              <form onSubmit={otpSent ? onVerifyOtp : onSendOtp} className="grid gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="login-otp-email">Email</Label>
                  <Input
                    id="login-otp-email"
                    type="email"
                    required
                    autoComplete="username"
                    value={loginEmail}
                    onChange={(event) => setLoginEmail(event.target.value)}
                    placeholder="admin@retail.local"
                  />
                </div>
                {otpSent && (
                  <div className="grid gap-2">
                    <Label htmlFor="login-otp">6-digit code</Label>
                    <Input
                      id="login-otp"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      pattern="\d{6}"
                      maxLength={6}
                      required
                      value={loginOtp}
                      onChange={(event) => setLoginOtp(event.target.value.replace(/\D/g, '').slice(0, 6))}
                      placeholder="000000"
                    />
                  </div>
                )}
                {otpNotice && (
                  <Alert>
                    <AlertDescription>{otpNotice}</AlertDescription>
                  </Alert>
                )}
                {devOtpCode && (
                  <p data-testid="dev-otp-code" className="text-center text-xs text-muted-foreground">
                    Development code: {devOtpCode}
                  </p>
                )}
                {authError && (
                  <Alert variant="destructive">
                    <AlertDescription>{authError}</AlertDescription>
                  </Alert>
                )}
                <Button type="submit" className="w-full" disabled={authLoading}>
                  {authLoading
                    ? otpSent
                      ? 'Verifying…'
                      : 'Sending…'
                    : otpSent
                      ? 'Verify code'
                      : 'Send code'}
                </Button>
                {otpSent && (
                  <Button
                    type="button"
                    variant="ghost"
                    className="w-full"
                    disabled={authLoading}
                    onClick={onSendOtp}
                  >
                    Resend code
                  </Button>
                )}
              </form>
            </TabsContent>
          </Tabs>
          {onPasskeySignIn && passkeysAvailable && (
            <div className="mt-4 grid gap-2 border-t pt-4">
              <Button type="button" variant="outline" className="w-full" disabled={authLoading} onClick={onPasskeySignIn}>
                Sign in with a passkey
              </Button>
              <p className="text-center text-xs text-muted-foreground">Use your fingerprint, face or screen lock. Type your email above first to use a specific account.</p>
            </div>
          )}
          <p className="mt-4 text-center text-xs text-muted-foreground">
            Accounts are created by your administrator in Admin Portal.
          </p>
          <Button
            type="button"
            variant="outline"
            className="mt-3 w-full"
            onClick={() => { window.location.hash = '#/control'; }}
          >
            Open Platform Control Plane
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
