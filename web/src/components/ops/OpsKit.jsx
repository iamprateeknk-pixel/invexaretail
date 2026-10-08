import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  ArrowUpRight,
  CheckCircle2,
  CircleDot,
  Clock3,
  Cloud,
  CloudOff,
  LoaderCircle,
  MoreHorizontal,
  Sparkles,
  TriangleAlert,
} from 'lucide-react';

const toneClass = {
  neutral: 'border-border bg-card text-foreground',
  emerald: 'border-emerald-200/70 bg-emerald-50/70 text-emerald-950 dark:border-emerald-900/60 dark:bg-emerald-950/25 dark:text-emerald-100',
  blue: 'border-blue-200/70 bg-blue-50/70 text-blue-950 dark:border-blue-900/60 dark:bg-blue-950/25 dark:text-blue-100',
  amber: 'border-amber-200/70 bg-amber-50/70 text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/25 dark:text-amber-100',
  rose: 'border-rose-200/70 bg-rose-50/70 text-rose-950 dark:border-rose-900/60 dark:bg-rose-950/25 dark:text-rose-100',
  violet: 'border-violet-200/70 bg-violet-50/70 text-violet-950 dark:border-violet-900/60 dark:bg-violet-950/25 dark:text-violet-100',
};

export function OpsPageHeader({ eyebrow, title, description, status, actions }) {
  return (
    <div className="flex flex-col gap-4 rounded-2xl border bg-card/70 p-5 shadow-sm backdrop-blur md:flex-row md:items-center md:justify-between">
      <div className="min-w-0">
        {eyebrow && (
          <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold tracking-[0.16em] text-primary uppercase">
            <Sparkles className="size-3.5" />
            {eyebrow}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">{title}</h1>
          {status}
        </div>
        {description && <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function OpsMetricCard({ label, value, helper, icon: Icon = CircleDot, tone = 'neutral', trend, onClick }) {
  const Component = onClick ? 'button' : 'div';
  const className = [
    'group rounded-2xl border p-4 text-left shadow-sm transition-all',
    toneClass[tone] ?? toneClass.neutral,
    onClick ? 'hover:-translate-y-0.5 hover:shadow-md' : '',
  ].join(' ');
  return (
    <Component type={onClick ? 'button' : undefined} onClick={onClick} className={className}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold tracking-wide opacity-65 uppercase">{label}</p>
          <p className="mt-2 text-2xl font-bold tracking-tight">{value}</p>
        </div>
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-current/10 bg-background/60">
          <Icon className="size-5" />
        </div>
      </div>
      {(helper || trend) && (
        <div className="mt-3 flex items-center justify-between gap-2 text-xs">
          <span className="truncate">{helper}</span>
          {trend && <span className="shrink-0 font-semibold">{trend}</span>}
        </div>
      )}
    </Component>
  );
}

export function OpsProgress({ value = 0, label, caption, tone = 'emerald' }) {
  const safe = Math.max(0, Math.min(100, Number(value) || 0));
  const fill = {
    emerald: 'bg-emerald-500',
    blue: 'bg-blue-500',
    amber: 'bg-amber-500',
    rose: 'bg-rose-500',
    violet: 'bg-violet-500',
  }[tone] ?? 'bg-primary';
  return (
    <div className="space-y-2">
      {(label || caption) && (
        <div className="flex items-center justify-between gap-3 text-xs">
          <span className="font-medium">{label}</span>
          <span className="text-muted-foreground">{caption ?? String(Math.round(safe)) + '%'}</span>
        </div>
      )}
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div className={'h-full rounded-full transition-[width] duration-500 ' + fill} style={{ width: String(safe) + '%' }} />
      </div>
    </div>
  );
}

export function OpsProgressRing({ value = 0, size = 74, stroke = 8, label }) {
  const safe = Math.max(0, Math.min(100, Number(value) || 0));
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const dash = circumference * (safe / 100);
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="currentColor" strokeWidth={stroke} className="text-muted" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={String(dash) + ' ' + String(circumference - dash)}
          className="text-primary transition-all duration-500"
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        <div>
          <p className="text-sm font-bold">{Math.round(safe)}%</p>
          {label && <p className="text-[9px] text-muted-foreground">{label}</p>}
        </div>
      </div>
    </div>
  );
}

const workflowTone = {
  done: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300',
  active: 'border-primary/30 bg-primary/10 text-primary',
  waiting: 'border-border bg-muted/40 text-muted-foreground',
  danger: 'border-destructive/30 bg-destructive/10 text-destructive',
};

export function OpsWorkflowStepper({ steps = [] }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
      {steps.map((step, index) => (
        <div key={step.label} className={'relative rounded-xl border p-3 ' + (workflowTone[step.state] ?? workflowTone.waiting)}>
          <div className="flex items-center gap-3">
            <div className="grid size-8 shrink-0 place-items-center rounded-full border border-current/15 bg-background/70 text-xs font-bold">
              {step.state === 'done' ? <CheckCircle2 className="size-4" /> : index + 1}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{step.label}</p>
              {step.caption && <p className="truncate text-[11px]">{step.caption}</p>}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function OpsSyncStatus({ status = 'synced', label, detail }) {
  const config = {
    synced: { Icon: Cloud, text: 'Synced', className: 'text-emerald-700 bg-emerald-50 border-emerald-200 dark:text-emerald-300 dark:bg-emerald-950/30 dark:border-emerald-900/60' },
    syncing: { Icon: LoaderCircle, text: 'Syncing', className: 'text-blue-700 bg-blue-50 border-blue-200 dark:text-blue-300 dark:bg-blue-950/30 dark:border-blue-900/60' },
    offline: { Icon: CloudOff, text: 'Offline', className: 'text-amber-700 bg-amber-50 border-amber-200 dark:text-amber-300 dark:bg-amber-950/30 dark:border-amber-900/60' },
    stale: { Icon: TriangleAlert, text: 'Stale', className: 'text-rose-700 bg-rose-50 border-rose-200 dark:text-rose-300 dark:bg-rose-950/30 dark:border-rose-900/60' },
  }[status] ?? {};
  const Icon = config.Icon ?? Cloud;
  return (
    <div className={'inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs font-medium ' + (config.className ?? '')} title={detail}>
      <Icon className={'size-3.5 ' + (status === 'syncing' ? 'animate-spin' : '')} />
      {label ?? config.text}
    </div>
  );
}

export function OpsQueueCard({ title, subtitle, meta = [], status, progress, icon: Icon = Clock3, onClick, actionLabel = 'Open' }) {
  return (
    <Card className="overflow-hidden border-border/80 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md">
      <CardContent className="p-0">
        <button type="button" className="flex w-full items-stretch text-left" onClick={onClick}>
          <div className="flex w-14 shrink-0 items-center justify-center bg-muted/45">
            <Icon className="size-5 text-muted-foreground" />
          </div>
          <div className="min-w-0 flex-1 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-semibold">{title}</p>
                {subtitle && <p className="mt-0.5 truncate text-xs text-muted-foreground">{subtitle}</p>}
              </div>
              {status}
            </div>
            {meta.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                {meta.map((item) => <span key={item}>{item}</span>)}
              </div>
            )}
            {progress !== undefined && <div className="mt-3"><OpsProgress value={progress} /></div>}
          </div>
          <div className="flex w-20 shrink-0 items-center justify-center border-l bg-muted/20 text-xs font-semibold text-primary">
            {actionLabel}<ArrowUpRight className="ml-1 size-3.5" />
          </div>
        </button>
      </CardContent>
    </Card>
  );
}

export function OpsStatusChip({ status, children }) {
  const normalized = String(status ?? '').toUpperCase();
  let variant = 'outline';
  let className = '';
  if (['APPROVED', 'COMPLETED', 'RECEIVED', 'SYNCED', 'PICKED'].some((key) => normalized.includes(key))) {
    className = 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300';
  } else if (['OVERDUE', 'REJECTED', 'FAILED', 'BLOCKED'].some((key) => normalized.includes(key))) {
    variant = 'destructive';
  } else if (['PENDING', 'RECOUNT', 'PARTIAL', 'WARNING'].some((key) => normalized.includes(key))) {
    className = 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300';
  } else if (['IN_PROGRESS', 'PICKING', 'RECEIVING', 'SYNCING'].some((key) => normalized.includes(key))) {
    className = 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900/60 dark:bg-blue-950/40 dark:text-blue-300';
  }
  return <Badge variant={variant} className={className}>{children ?? status}</Badge>;
}

export function OpsEmptyState({ icon: Icon = MoreHorizontal, title, description, actionLabel, onAction }) {
  return (
    <div className="grid min-h-52 place-items-center rounded-2xl border border-dashed bg-muted/15 p-6 text-center">
      <div className="max-w-sm">
        <div className="mx-auto grid size-11 place-items-center rounded-2xl border bg-background shadow-sm">
          <Icon className="size-5 text-muted-foreground" />
        </div>
        <p className="mt-3 font-semibold">{title}</p>
        {description && <p className="mt-1 text-sm leading-5 text-muted-foreground">{description}</p>}
        {actionLabel && onAction && <Button className="mt-4" size="sm" onClick={onAction}>{actionLabel}</Button>}
      </div>
    </div>
  );
}
