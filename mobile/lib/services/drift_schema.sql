-- Invexa local SQLite schema (Week 16; updated through v5). Mirrors `_migrations` in
-- lib/services/native_database.dart; that file is authoritative and applies
-- these in order, tracking the version in PRAGMA user_version.
-- Sessions and refresh credentials are NOT stored here (secure storage only).
-- Do not store stock ledger rows here.

-- v1
CREATE TABLE IF NOT EXISTS queued_counts (
  local_id TEXT NOT NULL,
  company_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  seq INTEGER NOT NULL,
  PRIMARY KEY (company_id, local_id)
);
CREATE TABLE IF NOT EXISTS queued_actions (
  local_id TEXT PRIMARY KEY,
  payload_json TEXT NOT NULL,
  seq INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS queued_counts_company_idx ON queued_counts (company_id, seq);

-- v2
CREATE TABLE IF NOT EXISTS sync_commands (
  command_id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  base_version INTEGER NOT NULL,
  occurred_at TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  server_version INTEGER,
  created_seq INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sync_commands_company_status_idx ON sync_commands (company_id, status, created_seq);
CREATE TABLE IF NOT EXISTS entity_versions (
  company_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  PRIMARY KEY (company_id, entity_type, entity_id)
);

-- v3
CREATE TABLE IF NOT EXISTS device_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- v4
INSERT OR IGNORE INTO sync_commands (command_id, company_id, actor_id, type, entity_type, entity_id, base_version, occurred_at, payload_json, created_seq)
  SELECT 'COUNT:' || company_id || ':' || local_id, company_id, '', 'COUNT', 'count', local_id, 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), payload_json, seq
  FROM queued_counts;
INSERT OR IGNORE INTO sync_commands (command_id, company_id, actor_id, type, entity_type, entity_id, base_version, occurred_at, payload_json, created_seq)
  SELECT 'ACTION:' || local_id, '', '', 'ACTION', 'action', local_id, 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), payload_json, seq
  FROM queued_actions;
DROP TABLE queued_counts;
DROP TABLE queued_actions;

-- v5
CREATE TABLE IF NOT EXISTS read_model (
  scope TEXT NOT NULL,
  path TEXT NOT NULL,
  body TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (scope, path)
);
