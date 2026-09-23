import { AlertTriangle, Inbox, Loader2, ShieldOff, WifiOff } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

// Week 9 shared component: the five states the guide asks every module to
// have ("complete loading/empty/error/permission/offline states") instead
// of each page inventing its own. Workspace.jsx's own AccessRestricted and
// EmptyModule (component-local, one-off cards) are retired in favor of
// PermissionDeniedState and EmptyState below - the first real adoption of
// this component, not just an addition alongside the old one.

function StateCard({ icon: Icon, iconClassName, title, description, action, children, className }) {
  return (
    <Card className={cn('border-dashed', className)}>
      <CardContent className="flex min-h-72 flex-col items-center justify-center px-6 text-center">
        {Icon && (
          <div className={cn('mb-4 flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary', iconClassName)}>
            <Icon className="size-6" aria-hidden="true" />
          </div>
        )}
        <h3 className="text-base font-semibold">{title}</h3>
        {description && <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">{description}</p>}
        {children}
        {action && <div className="mt-5">{action}</div>}
      </CardContent>
    </Card>
  )
}

export function LoadingState({ label = 'Loading…', className }) {
  return (
    <div role="status" className={cn('flex min-h-72 flex-col items-center justify-center gap-3 text-muted-foreground', className)}>
      <Loader2 className="size-6 animate-spin" aria-hidden="true" />
      <span className="text-sm">{label}</span>
    </div>
  )
}

export function EmptyState({ title = 'Nothing here yet', description, action, className }) {
  return (
    <StateCard icon={Inbox} title={title} description={description} action={action} className={className} />
  )
}

export function ErrorState({ title = 'Something went wrong', description, onRetry, className }) {
  return (
    <StateCard
      icon={AlertTriangle}
      iconClassName="bg-destructive/10 text-destructive"
      title={title}
      description={description}
      action={onRetry && <Button onClick={onRetry}>Try again</Button>}
      className={className}
    />
  )
}

export function PermissionDeniedState({ onReturn, returnLabel = 'Return to dashboard', className }) {
  return (
    <StateCard
      icon={ShieldOff}
      title="Access restricted"
      description="Your role does not have permission to open this workspace."
      action={onReturn && <Button onClick={onReturn}>{returnLabel}</Button>}
      className={className}
    />
  )
}

export function OfflineState({ onRetry, className }) {
  return (
    <StateCard
      icon={WifiOff}
      iconClassName="bg-warning/10 text-warning"
      title="You're offline"
      description="Live updates are paused. Reconnect to see the latest data."
      action={onRetry && <Button onClick={onRetry}>Retry connection</Button>}
      className={className}
    />
  )
}
