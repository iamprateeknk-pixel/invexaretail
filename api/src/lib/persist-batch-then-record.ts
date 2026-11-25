/** Persist a complete batch before publishing any of its records to a memory mirror. */
export async function persistBatchThenRecord<T>(
  records: readonly T[],
  persist: (records: readonly T[]) => Promise<unknown>,
  record: (entry: T) => unknown,
): Promise<void> {
  await persist(records);
  for (const entry of records) record(entry);
}
