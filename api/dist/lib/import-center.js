"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ImportTemplateRegistry = exports.ImportDuplicateGuard = exports.DuplicateImportBatchError = exports.InvalidBatchTransitionError = void 0;
exports.assertValidBatchTransition = assertValidBatchTransition;
exports.computeFileHash = computeFileHash;
exports.suggestFixFor = suggestFixFor;
exports.buildImportErrorReport = buildImportErrorReport;
exports.errorReportToCsv = errorReportToCsv;
// Import Center controls (blueprint section 12): the pieces that sit above
// the existing per-format parsers (stock-import.ts, daily-stock-sync.ts) and
// are shared by every import type — batch lifecycle, saved column-mapping
// templates, file-hash duplicate/idempotency protection, and turning row
// errors into an exportable, actionable report.
const node_crypto_1 = require("node:crypto");
const ALLOWED_TRANSITIONS = {
    DRAFT: ['PREVIEWED', 'FAILED'],
    PREVIEWED: ['VALIDATED', 'FAILED'],
    VALIDATED: ['POSTED', 'FAILED'],
    // A batch cannot be posted twice (idempotency) and posted history is never
    // deleted — the only way out of POSTED is an authorized reversal.
    POSTED: ['REVERSED'],
    REVERSED: [],
    FAILED: ['DRAFT'],
};
class InvalidBatchTransitionError extends Error {
    from;
    to;
    constructor(from, to) {
        super(`Cannot move import batch from ${from} to ${to}.`);
        this.from = from;
        this.to = to;
        this.name = 'InvalidBatchTransitionError';
    }
}
exports.InvalidBatchTransitionError = InvalidBatchTransitionError;
function assertValidBatchTransition(from, to) {
    if (!ALLOWED_TRANSITIONS[from].includes(to)) {
        throw new InvalidBatchTransitionError(from, to);
    }
}
function computeFileHash(buffer) {
    return (0, node_crypto_1.createHash)('sha256').update(buffer).digest('hex');
}
function fingerprintKey(fp) {
    return [fp.sourceType, fp.branchCode.trim().toLowerCase(), fp.fileHash, fp.sourceDateFrom, fp.sourceDateTo].join('|');
}
class DuplicateImportBatchError extends Error {
    existingBatchId;
    constructor(existingBatchId) {
        super(`This file was already imported as batch ${existingBatchId}.`);
        this.existingBatchId = existingBatchId;
        this.name = 'DuplicateImportBatchError';
    }
}
exports.DuplicateImportBatchError = DuplicateImportBatchError;
/**
 * Tracks one fingerprint per accepted batch so the same file (same branch,
 * same source date range) cannot be re-imported as a fresh batch, and a
 * batch cannot be posted a second time under a new id.
 */
class ImportDuplicateGuard {
    seen = new Map();
    /** Throws DuplicateImportBatchError if this exact file/branch/date range was already registered. */
    register(fingerprint, batchId) {
        const key = fingerprintKey(fingerprint);
        const existing = this.seen.get(key);
        if (existing)
            throw new DuplicateImportBatchError(existing);
        this.seen.set(key, batchId);
    }
    findExisting(fingerprint) {
        return this.seen.get(fingerprintKey(fingerprint));
    }
}
exports.ImportDuplicateGuard = ImportDuplicateGuard;
function normalizeHeader(value) {
    return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}
class ImportTemplateRegistry {
    templates = [];
    save(template) {
        const index = this.templates.findIndex((t) => t.id === template.id);
        if (index >= 0)
            this.templates[index] = template;
        else
            this.templates.push(template);
    }
    list(importType) {
        return this.templates.filter((t) => !importType || t.importType === importType).map((t) => ({ ...t }));
    }
    get(id) {
        const found = this.templates.find((t) => t.id === id);
        return found ? { ...found } : undefined;
    }
    /**
     * Scores every template of this import type against the file's actual
     * header row and returns the best match (and its match ratio), so the
     * Import Center can offer "we recognize this as your Logic ERP Sales
     * template" instead of asking for manual mapping every time.
     */
    findBestMatch(headers, importType) {
        const normalizedHeaders = new Set(headers.map(normalizeHeader));
        let best;
        for (const template of this.templates) {
            if (template.importType !== importType)
                continue;
            const expected = Object.values(template.columnMapping);
            if (expected.length === 0)
                continue;
            const matched = expected.filter((header) => normalizedHeaders.has(normalizeHeader(header))).length;
            const confidence = matched / expected.length;
            if (!best || confidence > best.confidence) {
                best = { template, confidence };
            }
        }
        return best;
    }
}
exports.ImportTemplateRegistry = ImportTemplateRegistry;
const SUGGESTION_RULES = [
    { pattern: /is required/i, suggestedFix: 'Fill in the missing value for this column and re-upload the row.' },
    { pattern: /invalid.*expected dd\/mm\/yyyy/i, suggestedFix: 'Re-enter the date in DD/MM/YYYY format.' },
    { pattern: /must be a valid number/i, suggestedFix: 'Remove currency symbols, commas or text from the quantity column.' },
    { pattern: /non-zero/i, suggestedFix: 'Confirm the quantity for this line; zero-quantity rows are not imported.' },
    { pattern: /unknown|not found/i, suggestedFix: 'Add the missing master record first, or correct the code to match an existing one.' },
    { pattern: /duplicate/i, suggestedFix: 'Remove the duplicate line from the source file, or confirm it is intentional.' },
];
function suggestFixFor(message) {
    return SUGGESTION_RULES.find((rule) => rule.pattern.test(message))?.suggestedFix
        ?? 'Review the source file for this row and correct the highlighted value.';
}
function buildImportErrorReport(errors) {
    return errors.map((error) => ({
        rowNumber: error.rowNumber,
        reason: error.message,
        suggestedFix: suggestFixFor(error.message),
    }));
}
function errorReportToCsv(entries) {
    const escape = (value) => (/[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
    const lines = ['Row Number,Reason,Suggested Fix', ...entries.map((e) => [e.rowNumber, escape(e.reason), escape(e.suggestedFix)].join(','))];
    return lines.join('\n');
}
