// Blueprint v4 §12: presentation rules for stock-take campaigns. Kept free
// of React so the state/permission/validation logic is unit-testable.

export const CAMPAIGN_STATUS = {
  DRAFT: { label: 'Draft', variant: 'outline', actions: ['activate', 'cancel'] },
  ACTIVE: { label: 'Active', variant: 'default', actions: ['run', 'pause', 'cancel'] },
  COUNTING: { label: 'Counting', variant: 'default', actions: ['run', 'pause', 'cancel'] },
  IN_REVIEW: { label: 'In review', variant: 'warning', actions: ['run', 'pause', 'cancel'] },
  COMPLETED: { label: 'Completed', variant: 'success', actions: [] },
  PAUSED: { label: 'Paused', variant: 'secondary', actions: ['resume', 'cancel'] },
  CANCELLED: { label: 'Cancelled', variant: 'outline', actions: [] },
};

export const CAMPAIGN_ACTION_LABEL = {
  activate: 'Activate',
  run: 'Run today',
  pause: 'Pause',
  resume: 'Resume',
  cancel: 'Cancel',
};

export const ITEM_STATUS_LABEL = {
  PENDING: 'Queued',
  ASSIGNED: 'Assigned',
  SUBMITTED: 'In review',
  RECOUNT: 'Recount',
  APPROVED: 'Approved',
  DISPOSITIONED: 'Dispositioned',
  EXCLUDED: 'Excluded',
};

export function campaignStatusMeta(status) {
  return CAMPAIGN_STATUS[status] ?? { label: String(status ?? 'Unknown'), variant: 'outline', actions: [] };
}

/** Store users who can be given work at this location (the server enforces the same rule). */
export function storeUsersForLocation(storeUsers, locationId) {
  return (storeUsers ?? []).filter((user) => (user.assignedLocationIds ?? []).includes(locationId));
}

export function progressSegments(progress) {
  const byStatus = progress?.byStatus ?? {};
  return Object.keys(ITEM_STATUS_LABEL)
    .filter((key) => key !== 'EXCLUDED' && (byStatus[key] ?? 0) > 0)
    .map((key) => ({ key, label: ITEM_STATUS_LABEL[key], count: byStatus[key] }));
}

/** Validates the create form and returns the API payload, or a list of problems. */
export function validateCampaignForm(form, locationId) {
  const errors = [];
  const name = String(form.name ?? '').trim();
  if (name.length < 2) errors.push('Enter a campaign name.');
  const quota = Number(form.dailyItemsPerUser);
  if (!Number.isInteger(quota) || quota < 1 || quota > 500) errors.push('Daily items per user must be a whole number from 1 to 500.');
  if (!form.userIds?.length) errors.push('Select at least one store user.');
  if (form.startDate && form.endDate && form.endDate < form.startDate) errors.push('End date must be on or after the start date.');
  if (!locationId) errors.push('Select a location first.');
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    errors,
    payload: {
      name,
      locationId,
      dailyItemsPerUser: quota,
      userIds: form.userIds,
      includeNewStock: form.includeNewStock !== false,
      ...(form.startDate ? { startDate: form.startDate } : {}),
      ...(form.endDate ? { endDate: form.endDate } : {}),
    },
  };
}

export function describeRunResult(result) {
  if (!result) return '';
  if (result.ran) {
    const users = Object.keys(result.perUser ?? {}).length;
    return result.assigned
      ? `Assigned ${result.assigned} item${result.assigned === 1 ? '' : 's'} to ${users} user${users === 1 ? '' : 's'}.`
      : 'Everyone already has a full day of work - nothing new to assign.';
  }
  const reasons = {
    NOT_RUNNABLE: 'The campaign is not running.',
    NOT_STARTED: 'The campaign has not started yet.',
    ENDED: 'The campaign end date has passed.',
    ALREADY_RAN: "Today's work was already assigned.",
    NO_ACTIVE_USERS: 'No active store users are left on this campaign.',
  };
  return reasons[result.skipped] ?? 'Nothing to run.';
}
