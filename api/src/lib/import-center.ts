// Import Center controls (blueprint section 12): the pieces that sit above
// the existing per-format parsers (stock-import.ts, daily-stock-sync.ts) and
// are shared by every import type — batch lifecycle, saved column-mapping
// templates, file-hash duplicate/idempotency protection, and turning row
// errors into an exportable, actionable report.
import { createHash } from 'node:crypto';

// ----------------------------------------------------------------------------
// 12.1 Import pipeline: Draft -> Preview -> Validate -> Post -> Audit -> Reverse
// ----------------------------------------------------------------------------

export type ImportBatchStatus = 'DRAFT' | 'PREVIEWED' | 'VALIDATED' | 'POSTED' | 'REVERSED' | 'FAILED';

const ALLOWED_TRANSITIONS: Record<ImportBatchStatus, ImportBatchStatus[]> = {
  DRAFT: ['PREVIEWED', 'FAILED'],
  PREVIEWED: ['VALIDATED', 'FAILED'],
  VALIDATED: ['POSTED', 'FAILED'],
  // A batch cannot be posted twice (idempotency) and posted history is never
  // deleted — the only way out of POSTED is an authorized reversal.
  POSTED: ['REVERSED'],
  REVERSED: [],
  FAILED: ['DRAFT'],
};

export class InvalidBatchTransitionError extends Error {
  constructor(public readonly from: ImportBatchStatus, public readonly to: ImportBatchStatus) {
    super(`Cannot move import batch from ${from} to ${to}.`);
    this.name = 'InvalidBatchTransitionError';
  }
}

export function assertValidBatchTransition(from: ImportBatchStatus, to: ImportBatchStatus): void {
  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    throw new InvalidBatchTransitionError(from, to);
  }
}

// ----------------------------------------------------------------------------
// 12.2 Duplicate protection: file hash + source date + branch + source doc
// ----------------------------------------------------------------------------

export type BatchFingerprint = {
  sourceType: string;
  branchCode: string;
  fileHash: string;
  sourceDateFrom: string;
  sourceDateTo: string;
};

export function computeFileHash(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

function fingerprintKey(fp: BatchFingerprint): string {
  return [fp.sourceType, fp.branchCode.trim().toLowerCase(), fp.fileHash, fp.sourceDateFrom, fp.sourceDateTo].join('|');
}

export class DuplicateImportBatchError extends Error {
  constructor(public readonly existingBatchId: string) {
    super(`This file was already imported as batch ${existingBatchId}.`);
    this.name = 'DuplicateImportBatchError';
  }
}

/**
 * Tracks one fingerprint per accepted batch so the same file (same branch,
 * same source date range) cannot be re-imported as a fresh batch, and a
 * batch cannot be posted a second time under a new id.
 */
export class ImportDuplicateGuard {
  private readonly seen = new Map<string, string>();

  /** Throws DuplicateImportBatchError if this exact file/branch/date range was already registered. */
  register(fingerprint: BatchFingerprint, batchId: string): void {
    const key = fingerprintKey(fingerprint);
    const existing = this.seen.get(key);
    if (existing) throw new DuplicateImportBatchError(existing);
    this.seen.set(key, batchId);
  }

  findExisting(fingerprint: BatchFingerprint): string | undefined {
    return this.seen.get(fingerprintKey(fingerprint));
  }
}

// ----------------------------------------------------------------------------
// 12.2 Saved mapping templates ("Logic ERP Sales", "Logic ERP Purchase", ...)
// ----------------------------------------------------------------------------

export type ImportTemplate = {
  id: string;
  name: string;
  importType: string;
  /** field name -> the exact header text this template expects for that field */
  columnMapping: Record<string, string>;
};

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

export class ImportTemplateRegistry {
  private readonly templates: ImportTemplate[] = [];

  save(template: ImportTemplate): void {
    const index = this.templates.findIndex((t) => t.id === template.id);
    if (index >= 0) this.templates[index] = template;
    else this.templates.push(template);
  }

  list(importType?: string): ImportTemplate[] {
    return this.templates.filter((t) => !importType || t.importType === importType).map((t) => ({ ...t }));
  }

  get(id: string): ImportTemplate | undefined {
    const found = this.templates.find((t) => t.id === id);
    return found ? { ...found } : undefined;
  }

  /**
   * Scores every template of this import type against the file's actual
   * header row and returns the best match (and its match ratio), so the
   * Import Center can offer "we recognize this as your Logic ERP Sales
   * template" instead of asking for manual mapping every time.
   */
  findBestMatch(headers: string[], importType: string): { template: ImportTemplate; confidence: number } | undefined {
    const normalizedHeaders = new Set(headers.map(normalizeHeader));
    let best: { template: ImportTemplate; confidence: number } | undefined;

    for (const template of this.templates) {
      if (template.importType !== importType) continue;
      const expected = Object.values(template.columnMapping);
      if (expected.length === 0) continue;
      const matched = expected.filter((header) => normalizedHeaders.has(normalizeHeader(header))).length;
      const confidence = matched / expected.length;
      if (!best || confidence > best.confidence) {
        best = { template, confidence };
      }
    }
    return best;
  }
}

// ----------------------------------------------------------------------------
// Error export: row number, reason and a suggested fix (blueprint 12.2)
// ----------------------------------------------------------------------------

export type ImportRowError = { rowNumber: number; message: string };
export type ImportErrorReportEntry = { rowNumber: number; reason: string; suggestedFix: string };

const SUGGESTION_RULES: Array<{ pattern: RegExp; suggestedFix: string }> = [
  { pattern: /is required/i, suggestedFix: 'Fill in the missing value for this column and re-upload the row.' },
  { pattern: /invalid.*expected dd\/mm\/yyyy/i, suggestedFix: 'Re-enter the date in DD/MM/YYYY format.' },
  { pattern: /must be a valid number/i, suggestedFix: 'Remove currency symbols, commas or text from the quantity column.' },
  { pattern: /non-zero/i, suggestedFix: 'Confirm the quantity for this line; zero-quantity rows are not imported.' },
  { pattern: /unknown|not found/i, suggestedFix: 'Add the missing master record first, or correct the code to match an existing one.' },
  { pattern: /duplicate/i, suggestedFix: 'Remove the duplicate line from the source file, or confirm it is intentional.' },
];

export function suggestFixFor(message: string): string {
  return SUGGESTION_RULES.find((rule) => rule.pattern.test(message))?.suggestedFix
    ?? 'Review the source file for this row and correct the highlighted value.';
}

export function buildImportErrorReport(errors: ImportRowError[]): ImportErrorReportEntry[] {
  return errors.map((error) => ({
    rowNumber: error.rowNumber,
    reason: error.message,
    suggestedFix: suggestFixFor(error.message),
  }));
}

export function errorReportToCsv(entries: ImportErrorReportEntry[]): string {
  const escape = (value: string) => (/[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
  const lines = ['Row Number,Reason,Suggested Fix', ...entries.map((e) => [e.rowNumber, escape(e.reason), escape(e.suggestedFix)].join(','))];
  return lines.join('\n');
}
