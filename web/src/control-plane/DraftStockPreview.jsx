import { useEffect, useId, useState } from 'react';
import { StockItemsTable } from '@/components/inventory/StockItemsTable';
import { StockOverviewActions } from '@/components/inventory/StockOverviewActions';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/feedback-states';
import { Label } from '@/components/ui/label';
import { canViewSystemStockForRole } from '@/lib/stock-metadata';
import { stockTableColumns } from '@/lib/stock-table';
import { controlRequest } from './control-api';
import { ROLE_OPTIONS } from './studio-catalog';

const DEVICES = {
  desktop: { label: 'Desktop' },
  tablet: { label: 'Tablet', width: 768 },
  mobile: { label: 'Phone', width: 390 },
};
const PREVIEW_ROLES = [...ROLE_OPTIONS, { value: 'ADMIN_USER', label: 'Admin user' }];
const ITEMS = [
  { id: 'sample-1', code: 'EX-001', name: 'Oats', company: 'Example supplier', category: 'Pantry', subcategory: 'Grains', unit: '500 g' },
  { id: 'sample-2', code: 'EX-002', name: 'Hand wash', company: 'Example supplier', category: 'Household', subcategory: 'Personal care', unit: '250 ml' },
];

function sampleRows(location) {
  const warehouse = location?.type === 'warehouse';
  return ITEMS.map((item, index) => {
    const physicalQuantity = (warehouse ? 120 : 24) + index * 6;
    const variance = index === 0 ? -2 : 0;
    return {
      itemId: item.id, locationId: location?.id ?? 'sample', lotIds: [`sample-lot-${index}`],
      physicalQuantity, bookQuantity: physicalQuantity - variance, variance,
      quarantineQuantity: index, reservedQuantity: 4, stockValue: physicalQuantity * 100,
    };
  });
}

function PreviewSelect({ label, value, onChange, children, disabled }) {
  const id = useId();
  return <div className="grid gap-1.5">
    <Label htmlFor={id}>{label}</Label>
    <select id={id} value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled}
      className="h-9 min-w-0 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-ring disabled:opacity-60">
      {children}
    </select>
  </div>;
}

export function DraftStockPreview({ controlToken, draft, onPublish, onRequestReview, onSchedule, onCancelSchedule, onRefreshRelease }) {
  const [role, setRole] = useState('ADMIN');
  const [device, setDevice] = useState('desktop');
  const [locationId, setLocationId] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState(null);
  const [publishing, setPublishing] = useState(false);
  const current = result?.role === role && result.controlToken === controlToken && result.device === device && result.locationId === locationId
    && result.draft === draft && result.attempt === attempt;
  const preview = current ? result.preview : null;
  const locationOptions = result?.controlToken === controlToken ? (result?.preview?.locations ?? result?.locations ?? []) : [];

  useEffect(() => {
    if (!controlToken) return;
    const controller = new AbortController();
    const context = { controlToken, role, device, locationId, draft, attempt };
    controlRequest('/studio/v1/preview', {
      token: controlToken, method: 'POST', signal: controller.signal, body: { role, device, ...(locationId ? { locationId } : {}) },
    }).then(({ preview: data }) => {
      if (!controller.signal.aborted) setResult({ ...context, preview: data });
    }).catch((error) => {
      if (!controller.signal.aborted) setResult((previous) => ({ ...context, error,
        locations: previous?.controlToken === controlToken ? (previous?.preview?.locations ?? previous?.locations) : [],
      }));
    });
    return () => controller.abort();
  }, [controlToken, draft, role, device, locationId, attempt]);

  const columns = preview ? stockTableColumns(preview.page, { role: preview.role, canViewSystemStock: canViewSystemStockForRole(preview.role) }) : [];
  const review = preview?.releaseReview;
  const schedule = preview?.releaseSchedule;
  const activationId = useId();
  const [activationTime, setActivationTime] = useState('');
  const [reviewerId, setReviewerId] = useState('');
  const needsRequest = review?.required && !review.request;
  const waitingForReviewer = Boolean(review?.request && !review.canApprove);
  async function publish() {
    setPublishing(true);
    try {
      if (needsRequest) {
        await onRequestReview(preview.draftRevision, reviewerId || undefined);
        setAttempt((value) => value + 1);
      } else {
        await onPublish(preview.draftRevision, review?.request?.id);
      }
    } finally {
      setPublishing(false);
    }
  }
  async function updateSchedule(action) {
    setPublishing(true);
    try {
      await action();
      setAttempt((value) => value + 1);
    } finally {
      setPublishing(false);
    }
  }
  return (
    <section aria-label="Draft stock preview" className="grid min-w-0 gap-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <PreviewSelect label="Role" value={role} onChange={setRole}>
          {PREVIEW_ROLES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </PreviewSelect>
        <PreviewSelect label="Device" value={device} onChange={setDevice}>
          {Object.entries(DEVICES).map(([key, option]) => <option key={key} value={key}>{option.label}</option>)}
        </PreviewSelect>
        <PreviewSelect label="Location" value={locationId || preview?.location?.id || locationOptions[0]?.id || ''} onChange={setLocationId} disabled={locationOptions.length === 0}>
          {!locationOptions.length && <option value="">No locations available</option>}
          {locationOptions.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
        </PreviewSelect>
      </div>
      {current && result.error ? <ErrorState title="Could not load the draft preview" description={result.error.message}
        onRetry={() => setAttempt((value) => value + 1)} /> : !preview ? <LoadingState label="Loading draft stock preview…" /> : (
        <Card className="mx-auto w-full min-w-0 overflow-hidden" style={{ maxWidth: DEVICES[device].width }}>
          <CardHeader className="gap-3">
            <div>
              <CardTitle className="text-base">Stock by item</CardTitle>
              <p className="text-sm text-muted-foreground">{preview.location?.name ?? 'Sample location'} · {DEVICES[device].label}</p>
              <p className="text-xs text-muted-foreground">Draft v{preview.version} · Sample stock and disabled actions</p>
            </div>
            {preview.stockEnabled !== false && <div className="flex flex-wrap gap-2"><StockOverviewActions page={preview.page} role={preview.role} /></div>}
          </CardHeader>
          {preview.stockEnabled === false ? <CardContent><EmptyState title="Stock is unavailable for this company" /></CardContent> : (
            <StockItemsTable columns={columns} rows={sampleRows(preview.location)} items={ITEMS} label="Draft stock table" variantFields={preview.variantFields} />
          )}
        </Card>
      )}
      {schedule && <div className="flex flex-wrap items-center gap-3">
        <p role="status" className="text-sm text-muted-foreground">
          {schedule.status === 'blocked' ? `Scheduled release blocked. ${schedule.failure}`
            : <>Release scheduled for <time dateTime={schedule.activateAt}>{new Date(schedule.activateAt).toLocaleString()}</time>.</>}
        </p>
        <Button type="button" variant="outline" disabled={publishing}
          onClick={() => updateSchedule(() => onRefreshRelease?.())}>Refresh release status</Button>
        {onCancelSchedule && <Button type="button" variant="outline" disabled={publishing}
          onClick={() => updateSchedule(() => onCancelSchedule(schedule.id))}>Cancel schedule</Button>}
      </div>}
      {onPublish && !schedule && <div className="flex flex-wrap items-center gap-3">
        {needsRequest && Boolean(review.reviewers?.length) && <PreviewSelect label="Reviewer" value={reviewerId} onChange={setReviewerId}>
          <option value="">Another Studio operator</option>
          {review.reviewers.map((user) => <option key={user.id} value={user.id}>{user.name} ({user.email})</option>)}
        </PreviewSelect>}
        <Button type="button" disabled={publishing || !preview?.draftRevision || waitingForReviewer || (needsRequest && !onRequestReview)} onClick={publish}>
          {publishing ? 'Saving…' : needsRequest ? 'Request approval' : review?.request?.approvedAt
            ? 'Publish approved draft' : review?.request ? 'Approve and publish' : 'Publish reviewed draft'}
        </Button>
        {!review?.required && preview?.draftRevision && onSchedule && onRequestReview && <Button type="button" variant="outline"
          disabled={publishing} onClick={() => updateSchedule(() => onRequestReview(preview.draftRevision))}>
          Request approval to schedule
        </Button>}
        {waitingForReviewer && <>
          <p role="status" className="text-sm text-muted-foreground">{review.request.reviewerId
            ? 'Waiting for the assigned company administrator to approve in the workspace.'
            : 'Waiting for another operator to review and publish this draft.'}</p>
          <Button type="button" variant="outline" onClick={() => setAttempt((value) => value + 1)}>Refresh approval</Button>
        </>}
      </div>}
      {!schedule && review?.request && review.canApprove && onSchedule && <div className="flex flex-wrap items-end gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor={activationId}>Activation time (local)</Label>
          <input id={activationId} type="datetime-local" value={activationTime} onChange={(event) => setActivationTime(event.target.value)}
            className="h-9 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-ring" />
        </div>
        <Button type="button" variant="outline" disabled={publishing || !preview.draftRevision || !Number.isFinite(Date.parse(activationTime))}
          onClick={() => updateSchedule(() => onSchedule(preview.draftRevision, review.request.id, new Date(activationTime).toISOString()))}>
          {review.request.approvedAt ? 'Schedule approved draft' : 'Approve and schedule'}
        </Button>
      </div>}
    </section>
  );
}
