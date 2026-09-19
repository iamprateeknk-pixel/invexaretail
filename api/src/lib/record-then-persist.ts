// Blueprint v4 §40 Recovery: "no double posting after timeout/restart", and its
// mirror image - no phantom record. The API keeps an in-memory copy beside the
// database. If the database write fails, the in-memory copy must go too;
// otherwise a retry with the same request id is answered "already done" for
// something that was never saved, and the record vanishes on the next restart.

export async function recordThenPersist<T>(apply: () => T, persist: (record: T) => Promise<unknown>, rollback: (record: T) => void): Promise<T> {
  const record = apply();
  try {
    await persist(record);
  } catch (error) {
    rollback(record);
    throw error;
  }
  return record;
}
