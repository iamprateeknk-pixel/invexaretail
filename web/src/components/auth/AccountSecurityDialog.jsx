import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { TwoFactorPanel } from './TwoFactorPanel'

// Account security for the signed-in person, reachable from the account menu
// for every role (the two-factor API works for all roles).
export function AccountSecurityDialog({ open, onOpenChange, authToken }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Account security</DialogTitle>
          <DialogDescription>Protect your sign-in with a code from an authenticator app.</DialogDescription>
        </DialogHeader>
        {open && <TwoFactorPanel authToken={authToken} />}
      </DialogContent>
    </Dialog>
  )
}
