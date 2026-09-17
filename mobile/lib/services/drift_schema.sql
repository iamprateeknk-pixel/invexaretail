-- Invexa Drift local schema. Company-scoped sealed mutations and count
-- queues. Do not store stock ledger rows here.
-- Applied by NativeDatabase in lib/services/native_database.dart.
CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  company_id TEXT NOT NULL,
  token TEXT NOT NULL,
  refresh_token TEXT,
  user_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sealed_mutations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  envelope TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (company_id, seq)
);

CREATE TABLE IF NOT EXISTS queued_counts (
  local_id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  seq INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS sealed_mutations_company_idx ON sealed_mutations (company_id);
CREATE INDEX IF NOT EXISTS queued_counts_company_idx ON queued_counts (company_id);
