import { COLUMN_ROLES, DEFAULT_TABLE_COLUMNS } from './control-plane-defaults.js';
import type { ColumnDefinition, PageDefinition, TableKey } from './control-plane.js';

export class ControlPlaneError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = 'ControlPlaneError';
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Which roles may see a column. No list (or every role) = everyone. ADMIN is always included so a layout
 * can never hide a column from the people who manage it.
 */
export function normalizeColumnRoles(input: unknown): string[] | undefined {
  if (input === null || input === undefined) return undefined;
  if (!Array.isArray(input)) throw new ControlPlaneError('Roles must be a list', 'INVALID_ROLE', 400);
  if (input.length === 0) return undefined;
  const roles = new Set<string>(['ADMIN']);
  for (const role of input) {
    if (!(COLUMN_ROLES as readonly string[]).includes(String(role))) throw new ControlPlaneError(`Unknown role "${String(role)}"`, 'INVALID_ROLE', 400);
    roles.add(String(role));
  }
  return roles.size === COLUMN_ROLES.length ? undefined : COLUMN_ROLES.filter((role) => roles.has(role));
}

/** Columns of one table on a page; non-stock tables are created from their defaults on first use. */
export function pageTableColumns(page: PageDefinition, table: TableKey): ColumnDefinition[] {
  if (table === 'stock') return page.columns;
  page.tables ??= {};
  return (page.tables[table] ??= JSON.parse(JSON.stringify(DEFAULT_TABLE_COLUMNS[table])) as ColumnDefinition[]);
}

export function clonePage(page: PageDefinition): PageDefinition {
  return JSON.parse(JSON.stringify(page)) as PageDefinition;
}
