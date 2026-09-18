import { endOfLocalDayIso, localDateString } from './stock-take-campaign.js';

// Blueprint v4 §10.1 Import Control Center: is each branch's daily sales /
// purchase data in, missing or only partly in? Pure so the rules are testable;
// the route supplies movement activity and rejected-row counts.

export type ImportSourceType = 'SALES' | 'PURCHASE';
export type DayStatus = 'UPLOADED' | 'PARTIAL' | 'MISSING';

export type MovementActivity = {
  locationId: string;
  sourceType: ImportSourceType;
  count: number;
  lastTransactionAt: string;
  batchIds: string[];
};

export type ControlCenterLocation = { id: string; name: string; type: 'store' | 'warehouse' };

export type BranchDay = {
  locationId: string;
  locationName: string;
  status: DayStatus;
  movements: number;
  lastTransactionAt: string | null;
  rejectedRows: number;
};

export type SourceDay = {
  status: DayStatus;
  branches: BranchDay[];
  batchIds: string[];
  // Rejected rows whose branch could not be matched (e.g. an unknown branch name).
  unattributedRejectedRows: number;
};

export type ControlCenterReport = {
  date: string;
  timezone: string;
  sales: SourceDay;
  purchases: SourceDay;
};

/** The UTC instants that bound one local calendar day. */
export function dayWindow(date: string, timezone: string): { from: string; to: string } {
  const previous = new Date(`${date}T00:00:00Z`);
  previous.setUTCDate(previous.getUTCDate() - 1);
  const previousDate = previous.toISOString().slice(0, 10);
  const from = new Date(new Date(endOfLocalDayIso(previousDate, timezone)).getTime() + 1000).toISOString();
  const to = new Date(new Date(endOfLocalDayIso(date, timezone)).getTime() + 1000).toISOString();
  return { from, to };
}

export function todayFor(timezone: string, now = new Date()): string {
  return localDateString(now, timezone);
}

function branchStatus(movements: number, rejectedRows: number): DayStatus {
  if (movements === 0) return 'MISSING';
  return rejectedRows > 0 ? 'PARTIAL' : 'UPLOADED';
}

function overall(branches: BranchDay[], unattributed: number): DayStatus {
  if (!branches.length) return unattributed > 0 ? 'PARTIAL' : 'MISSING';
  const anyMissing = branches.some((row) => row.status === 'MISSING');
  const anyIn = branches.some((row) => row.status !== 'MISSING');
  if (branches.every((row) => row.status === 'UPLOADED') && unattributed === 0) return 'UPLOADED';
  if (!anyIn) return unattributed > 0 ? 'PARTIAL' : 'MISSING';
  return anyMissing || unattributed > 0 || branches.some((row) => row.status === 'PARTIAL') ? 'PARTIAL' : 'UPLOADED';
}

/**
 * Sales are expected from every store, so a store with no sales that day is
 * MISSING. Purchases are only expected where they happen, so only locations
 * with purchase activity (or rejected purchase rows) are listed.
 */
export function buildControlCenter(input: {
  date: string;
  timezone: string;
  locations: ControlCenterLocation[];
  activity: MovementActivity[];
  rejectedByLocation: Map<string, { sales: number; purchases: number }>;
  unattributedRejected: { sales: number; purchases: number };
}): ControlCenterReport {
  const build = (sourceType: ImportSourceType, expected: ControlCenterLocation[], unattributed: number): SourceDay => {
    const rejectedKey = sourceType === 'SALES' ? 'sales' : 'purchases';
    const batchIds = new Set<string>();
    const byLocation = new Map<string, MovementActivity>();
    for (const row of input.activity) {
      if (row.sourceType !== sourceType) continue;
      byLocation.set(row.locationId, row);
      row.batchIds.forEach((id) => batchIds.add(id));
    }
    const shown = new Map(expected.map((location) => [location.id, location]));
    for (const locationId of byLocation.keys()) {
      const known = input.locations.find((location) => location.id === locationId);
      if (known) shown.set(locationId, known);
    }
    for (const [locationId, rejected] of input.rejectedByLocation) {
      const known = input.locations.find((location) => location.id === locationId);
      if (known && rejected[rejectedKey] > 0) shown.set(locationId, known);
    }
    const branches: BranchDay[] = [...shown.values()]
      .map((location) => {
        const activity = byLocation.get(location.id);
        const rejectedRows = input.rejectedByLocation.get(location.id)?.[rejectedKey] ?? 0;
        return {
          locationId: location.id,
          locationName: location.name,
          status: branchStatus(activity?.count ?? 0, rejectedRows),
          movements: activity?.count ?? 0,
          lastTransactionAt: activity?.lastTransactionAt ?? null,
          rejectedRows,
        };
      })
      .sort((a, b) => a.locationName.localeCompare(b.locationName));
    return { status: overall(branches, unattributed), branches, batchIds: [...batchIds], unattributedRejectedRows: unattributed };
  };

  return {
    date: input.date,
    timezone: input.timezone,
    sales: build('SALES', input.locations.filter((location) => location.type === 'store'), input.unattributedRejected.sales),
    purchases: build('PURCHASE', [], input.unattributedRejected.purchases),
  };
}

// ---- row-level reasons ----------------------------------------------------

export type RowReason = 'UNMATCHED_ITEM' | 'UNMATCHED_BRANCH' | 'UNMATCHED_LOT' | 'ARCHIVED_ITEM' | 'OTHER';

/** Buckets a row-level rejection message so the preview can count unmatched items, branches and lots separately. */
export function classifyImportError(message: string): RowReason {
  if (/is (archived|inactive|deactivated) and cannot be imported/i.test(message)) return 'ARCHIVED_ITEM';
  if (/unknown item code|unknown or ambiguous item name|item name is unknown/i.test(message)) return 'UNMATCHED_ITEM';
  if (/unknown branch|unknown location|branch.*(not found|unknown)/i.test(message)) return 'UNMATCHED_BRANCH';
  if (/lot.*(not found|unknown|unmatched)|unknown lot/i.test(message)) return 'UNMATCHED_LOT';
  return 'OTHER';
}

export type RowCounters = {
  total: number;
  valid: number;
  duplicate: number;
  unmatchedItem: number;
  unmatchedBranch: number;
  unmatchedLot: number;
  archivedItem: number;
  // Every other rejected row (bad date, non-numeric quantity, ...).
  rejected: number;
};

/** One rejected row is counted once, under its most specific reason. */
export function summarizeRowCounters(rows: Array<{ status: 'VALID' | 'INVALID' | 'DUPLICATE'; errors?: string[] | null }>): RowCounters {
  const counters: RowCounters = { total: rows.length, valid: 0, duplicate: 0, unmatchedItem: 0, unmatchedBranch: 0, unmatchedLot: 0, archivedItem: 0, rejected: 0 };
  for (const row of rows) {
    if (row.status === 'VALID') counters.valid += 1;
    else if (row.status === 'DUPLICATE') counters.duplicate += 1;
    else {
      const reasons = (row.errors ?? []).map(classifyImportError);
      const reason = (['UNMATCHED_BRANCH', 'UNMATCHED_ITEM', 'ARCHIVED_ITEM', 'UNMATCHED_LOT'] as RowReason[]).find((candidate) => reasons.includes(candidate)) ?? 'OTHER';
      if (reason === 'UNMATCHED_BRANCH') counters.unmatchedBranch += 1;
      else if (reason === 'UNMATCHED_ITEM') counters.unmatchedItem += 1;
      else if (reason === 'ARCHIVED_ITEM') counters.archivedItem += 1;
      else if (reason === 'UNMATCHED_LOT') counters.unmatchedLot += 1;
      else counters.rejected += 1;
    }
  }
  return counters;
}
