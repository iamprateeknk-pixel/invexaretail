const schedules = {
  'daily@09:00': { time: '09:00:00' },
  'daily@18:00': { time: '18:00:00' },
  'weekly@mon': { time: '09:00:00', weekday: 'Mon' },
  'monthly@1': { time: '09:00:00', day: '01' },
} as const;

export function isStudioSchedule(expression: string): boolean {
  return Object.hasOwn(schedules, expression);
}

/** Returns the local date of a due run. Missed runs can catch up on their scheduled day. */
export function scheduledStudioOccurrence(expression: string, now: Date, timezone: string, publishedAt: Date): string | null {
  if (!isStudioSchedule(expression) || !Number.isFinite(publishedAt.getTime()) || publishedAt > now) return null;
  const schedule = schedules[expression as keyof typeof schedules];
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
  const parts = (date: Date) => Object.fromEntries(formatter.formatToParts(date).map(({ type, value }) => [type, value]));
  const today = parts(now);
  if (('weekday' in schedule && schedule.weekday !== today.weekday) || ('day' in schedule && schedule.day !== today.day)) return null;
  const date = (p: ReturnType<typeof parts>) => `${p.year}-${p.month}-${p.day}`;
  const time = (p: ReturnType<typeof parts>) => `${p.hour}:${p.minute}:${p.second}`;
  const publication = parts(publishedAt);
  if (time(today) < schedule.time || (date(publication) === date(today) && time(publication) > schedule.time)) return null;
  return date(today);
}
