export type CampaignCandidate = {
  itemId: string;
  onHand: number;
  lastCountedAt?: string | null;
  priorityScore?: number;
};

export type CampaignUser = {
  userId: string;
  active?: boolean;
};

export type CampaignOpenTask = {
  itemId: string;
  userId: string;
  status: 'ASSIGNED' | 'IN_PROGRESS' | 'SUBMITTED' | 'IN_REVIEW' | 'RECOUNT';
};

export type CampaignDailyAssignment = {
  itemId: string;
  userId: string;
  sequence: number;
};

function countedAt(value?: string | null): number {
  if (!value) return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

/**
 * Produces a deterministic, branch-scoped daily campaign slice.
 *
 * Only positive-stock candidates may be scheduled. Completed items and items
 * already represented by an open task are excluded, so re-running this
 * function is idempotent from the scheduler's perspective.
 */
export function buildDailyCampaignAssignments(input: {
  candidates: CampaignCandidate[];
  users: CampaignUser[];
  dailyItemsPerUser: number;
  completedItemIds?: Iterable<string>;
  openTasks?: CampaignOpenTask[];
}): CampaignDailyAssignment[] {
  if (!Number.isInteger(input.dailyItemsPerUser) || input.dailyItemsPerUser <= 0) {
    throw new Error('dailyItemsPerUser must be a positive integer.');
  }

  const users = input.users.filter((user) => user.active !== false);
  if (users.length === 0) return [];

  const completed = new Set(input.completedItemIds ?? []);
  const alreadyOpen = new Set((input.openTasks ?? []).map((task) => task.itemId));

  const candidates = input.candidates
    .filter((item) => Number.isFinite(item.onHand) && item.onHand > 0)
    .filter((item) => !completed.has(item.itemId) && !alreadyOpen.has(item.itemId))
    .sort((a, b) => {
      // Never-counted items first, then oldest-counted items.
      const byAge = countedAt(a.lastCountedAt) - countedAt(b.lastCountedAt);
      if (byAge !== 0) return byAge;

      const byPriority = (b.priorityScore ?? 0) - (a.priorityScore ?? 0);
      if (byPriority !== 0) return byPriority;

      return a.itemId.localeCompare(b.itemId);
    });

  const capacity = new Map(users.map((user) => [user.userId, input.dailyItemsPerUser]));
  const assignments: CampaignDailyAssignment[] = [];
  let cursor = 0;

  for (const candidate of candidates) {
    let selected: CampaignUser | undefined;
    for (let tries = 0; tries < users.length; tries += 1) {
      const user = users[cursor % users.length];
      cursor += 1;
      if ((capacity.get(user.userId) ?? 0) > 0) {
        selected = user;
        break;
      }
    }
    if (!selected) break;

    const remaining = (capacity.get(selected.userId) ?? 0) - 1;
    capacity.set(selected.userId, remaining);
    assignments.push({
      itemId: candidate.itemId,
      userId: selected.userId,
      sequence: assignments.length + 1,
    });
  }

  return assignments;
}
