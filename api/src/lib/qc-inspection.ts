import { prisma } from './db.js';
import { createExceptionCase } from './exceptions.js';

// Blueprint §8.2 (Quality Control): "seal/packaging/weight/moisture/
// expiry-window checks" as a formal checklist. Structured itemized results
// replace a free-text ExceptionCase description; a FAIL still opens a
// QC_FAIL exception case exactly as before, now with the checklist itself
// as its evidence instead of whatever the reporter happened to type.
//
// Deliberately scoped as a standalone, optional tool for this pass rather
// than made mandatory on the receiving path: the receive endpoint's
// existing damage/discrepancy handling is already tested and load-bearing,
// and forcing every receipt through a checklist is a workflow change that
// belongs with a product decision, not a silent default. A receiver (or
// putaway confirmer) can call this any time; nothing requires it yet.

export const DEFAULT_QC_CHECKS: Array<{ key: string; label: string }> = [
  { key: 'SEAL_INTACT', label: 'Seal intact' },
  { key: 'PACKAGING_INTACT', label: 'Packaging intact' },
  { key: 'WEIGHT_MATCH', label: 'Weight matches expected' },
  { key: 'NO_MOISTURE_DAMAGE', label: 'No moisture damage' },
  { key: 'WITHIN_EXPIRY_WINDOW', label: 'Within expiry window' },
];

export type QcCheckResult = 'PASS' | 'FAIL' | 'NA';
export type QcTemplateLike = { id: string; category: string | null; active: boolean };

export type MemoryQcTemplate = QcTemplateLike & {
  label: string;
  checks: Array<{ key: string; label: string }>;
  createdById: string;
  createdAt: string;
};

export type MemoryQcInspection = {
  id: string;
  templateId: string;
  itemId: string | null;
  lotId: string | null;
  locationId: string | null;
  sourceDocument: string | null;
  sourceLineId: string | null;
  results: Record<string, QcCheckResult>;
  overallResult: 'PASS' | 'FAIL';
  notes: string | null;
  inspectedById: string;
  createdAt: string;
};

const memoryQcTemplates: MemoryQcTemplate[] = [];
const memoryQcInspections: MemoryQcInspection[] = [];

export function resetMemoryQc(): void {
  memoryQcTemplates.length = 0;
  memoryQcInspections.length = 0;
}

export function listMemoryQcTemplates(): MemoryQcTemplate[] {
  return memoryQcTemplates.map((row) => ({ ...row, checks: row.checks.map((check) => ({ ...check })) }));
}

export function listMemoryQcInspections(): MemoryQcInspection[] {
  return memoryQcInspections.map((row) => ({ ...row, results: { ...row.results } }));
}

export function createMemoryQcTemplate(input: {
  label: string;
  category?: string | null;
  checks: Array<{ key: string; label: string }>;
  createdById: string;
  active?: boolean;
}): MemoryQcTemplate {
  const template: MemoryQcTemplate = {
    id: `qc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    label: input.label,
    category: input.category ?? null,
    checks: input.checks,
    active: input.active !== false,
    createdById: input.createdById,
    createdAt: new Date().toISOString(),
  };
  memoryQcTemplates.push(template);
  return { ...template, checks: template.checks.map((check) => ({ ...check })) };
}

export function patchMemoryQcTemplate(id: string, data: Partial<Pick<MemoryQcTemplate, 'label' | 'category' | 'active' | 'checks'>>): MemoryQcTemplate | null {
  const row = memoryQcTemplates.find((template) => template.id === id);
  if (!row) return null;
  if (data.label !== undefined) row.label = data.label;
  if (data.category !== undefined) row.category = data.category;
  if (data.active !== undefined) row.active = data.active;
  if (data.checks !== undefined) row.checks = data.checks;
  return { ...row, checks: row.checks.map((check) => ({ ...check })) };
}

export function recordMemoryQcInspection(input: RecordQcInspectionInput): MemoryQcInspection {
  const overallResult = evaluateInspection(input.results);
  const inspection: MemoryQcInspection = {
    id: `qci-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    templateId: input.templateId || memoryQcTemplates[0]?.id || 'default-qc-template',
    itemId: input.itemId ?? null,
    lotId: input.lotId ?? null,
    locationId: input.locationId ?? null,
    sourceDocument: input.sourceDocument ?? null,
    sourceLineId: input.sourceLineId ?? null,
    results: { ...input.results },
    overallResult,
    notes: input.notes ?? null,
    inspectedById: input.inspectedById,
    createdAt: new Date().toISOString(),
  };
  memoryQcInspections.push(inspection);
  return { ...inspection, results: { ...inspection.results } };
}

/** Pure: most specific matching active template - category-scoped beats global, same convention as ToleranceRule/EvidenceRule/ApprovalRule. */
export function findTemplateForCategory<T extends QcTemplateLike>(templates: T[], category: string | null): T | null {
  const active = templates.filter((template) => template.active && (template.category === null || template.category === category));
  const specific = active.find((template) => template.category !== null);
  return specific ?? active.find((template) => template.category === null) ?? null;
}

/** Pure: a checklist fails overall if any individual check failed; NA checks never fail it. */
export function evaluateInspection(results: Record<string, QcCheckResult>): 'PASS' | 'FAIL' {
  return Object.values(results).some((result) => result === 'FAIL') ? 'FAIL' : 'PASS';
}

export type RecordQcInspectionInput = {
  templateId?: string | null;
  itemId?: string | null;
  itemCategory?: string | null;
  lotId?: string | null;
  locationId?: string | null;
  branchId?: string | null;
  sourceDocument?: string | null;
  sourceLineId?: string | null;
  results: Record<string, QcCheckResult>;
  notes?: string | null;
  inspectedById: string;
  companyId: string;
};

/**
 * Records a filled-in checklist and, on FAIL, opens the same QC_FAIL
 * exception case the receiving flow already uses for damage - so a QC
 * failure lands in the same Exception Inbox reviewers already work from.
 * Resolves the template explicitly when given, else the most specific
 * active template for the item's category, else a synthesized template
 * from DEFAULT_QC_CHECKS so a checklist is always available even before
 * any admin configures one.
 */
export async function recordQcInspection(input: RecordQcInspectionInput) {
  const { databaseEnabled } = await import('./persistence.js');
  if (!databaseEnabled) {
    return { inspection: recordMemoryQcInspection(input), exceptionCase: null };
  }
  let templateId = input.templateId ?? null;
  if (!templateId) {
    const templates = await prisma.qcChecklistTemplate.findMany({ where: { active: true, createdBy: { companyId: input.companyId } } });
    const matched = findTemplateForCategory(templates, input.itemCategory ?? null);
    templateId = matched?.id ?? null;
  }
  if (!templateId) {
    // One default checklist per company: a shared fixed id would be visible to (or owned by) whichever company created it first.
    const fallbackId = `default-qc-template:${input.companyId}`;
    const fallback = await prisma.qcChecklistTemplate.upsert({
      where: { id: fallbackId },
      update: {},
      create: {
        id: fallbackId, label: 'Default QC checklist', category: null,
        checks: DEFAULT_QC_CHECKS, active: true, createdById: input.inspectedById,
      },
    });
    templateId = fallback.id;
  }

  const overallResult = evaluateInspection(input.results);
  const inspection = await prisma.qcInspection.create({
    data: {
      templateId,
      itemId: input.itemId ?? null,
      lotId: input.lotId ?? null,
      locationId: input.locationId ?? null,
      sourceDocument: input.sourceDocument ?? null,
      sourceLineId: input.sourceLineId ?? null,
      results: input.results,
      overallResult,
      notes: input.notes ?? null,
      inspectedById: input.inspectedById,
    },
  });

  if (overallResult === 'FAIL') {
    const failedChecks = Object.entries(input.results).filter(([, result]) => result === 'FAIL').map(([key]) => key);
    const exceptionCase = await createExceptionCase({
      type: 'QC_FAIL',
      title: `QC checklist failed: ${failedChecks.join(', ')}`,
      description: input.notes ?? null,
      itemId: input.itemId ?? null,
      lotId: input.lotId ?? null,
      locationId: input.locationId ?? null,
      branchId: input.branchId ?? null,
      sourceDocument: input.sourceDocument ?? null,
      sourceLineId: input.sourceLineId ?? null,
      reportedById: input.inspectedById,
      companyId: input.companyId,
    });
    if (exceptionCase) {
      await prisma.qcInspection.update({ where: { id: inspection.id }, data: { exceptionCaseId: exceptionCase.id } });
      return { inspection: { ...inspection, exceptionCaseId: exceptionCase.id }, exceptionCase };
    }
  }
  return { inspection, exceptionCase: null };
}
