import { randomUUID } from 'node:crypto';

import { prisma, resolveDatabaseUrl } from './db.js';

const databaseEnabled = Boolean(resolveDatabaseUrl());

export const INDUSTRY_KEYS = ['grocery'] as const;

export type IndustryKey = (typeof INDUSTRY_KEYS)[number];
export type AllocationStrategy = 'FEFO' | 'FIFO';
export type DashboardKpiKey =
  | 'pending_counts'
  | 'transfers'
  | 'low_stock'
  | 'expiry_risk'
  | 'discrepancy'
  | 'pending_approvals'
  | 'assets'
  | 'jobs';

export type IndustryCustomFieldSeed = {
  name: string;
  type: 'text' | 'number' | 'date' | 'boolean' | 'select';
  options?: string[];
  required?: boolean;
};

export type IndustryPack = {
  key: IndustryKey;
  label: string;
  description: string;
  hide: string[];
  dashboardKpis: DashboardKpiKey[];
  allocationStrategy: AllocationStrategy;
  expiryBlocking: boolean;
  tags: Array<{ name: string; color: string }>;
  customFields: IndustryCustomFieldSeed[];
  categories: string[];
  units: string[];
  variantFields?: string[];
  serialFieldNames?: string[];
};

export type WorkspacePackView = {
  key: IndustryKey;
  label: string;
  description: string;
  hide: string[];
  dashboardKpis: DashboardKpiKey[];
  allocationStrategy: AllocationStrategy;
  expiryBlocking: boolean;
  modules: Record<string, boolean>;
  categories: string[];
  units: string[];
  variantFields: string[];
  serialFieldNames: string[];
};

export const INDUSTRY_PACKS: Record<IndustryKey, IndustryPack> = {
  grocery: {
    key: 'grocery',
    label: 'Grocery',
    description: 'Invexa grocery operations: lot/expiry stock, FEFO transfers, blind counts and branch replenishment.',
    hide: ['assets'],
    dashboardKpis: ['expiry_risk', 'low_stock', 'pending_counts', 'transfers', 'discrepancy', 'pending_approvals'],
    allocationStrategy: 'FEFO',
    expiryBlocking: true, // perishables: lapsed lots must not stay pickable (audit S-3)
    tags: [
      { name: 'Fresh', color: 'emerald' },
      { name: 'Chilled', color: 'cyan' },
      { name: 'Frozen', color: 'blue' },
    ],
    customFields: [
      { name: 'Storage temperature', type: 'select', options: ['Ambient', 'Chilled', 'Frozen'] },
      { name: 'Perishable', type: 'boolean' },
    ],
    categories: ['Staples', 'Dairy', 'Household', 'Produce', 'Bakery', 'Frozen', 'Grocery'],
    units: ['bag', 'pack', 'box', 'KG', 'PCS'],
  },
};

export type ActiveWorkflow = {
  allocationStrategy: AllocationStrategy;
  expiryBlocking: boolean;
  fefoEnforced: boolean;
  industryKey: IndustryKey;
};

let activeWorkflow: ActiveWorkflow = workflowFromPack(INDUSTRY_PACKS.grocery);

export function listIndustryCatalog(): IndustryPack[] {
  return INDUSTRY_KEYS.map((key) => INDUSTRY_PACKS[key]);
}

export function isIndustryKey(value: unknown): value is IndustryKey {
  return typeof value === 'string' && (INDUSTRY_KEYS as readonly string[]).includes(value);
}

export function resolveIndustryKey(_value?: string | null): IndustryKey {
  return 'grocery';
}

export function getIndustryPack(key?: string | null): IndustryPack {
  return INDUSTRY_PACKS[resolveIndustryKey(key)];
}

export function toWorkspacePackView(pack: IndustryPack): WorkspacePackView {
  const hidden = new Set(pack.hide);
  return {
    key: pack.key,
    label: pack.label,
    description: pack.description,
    hide: pack.hide,
    dashboardKpis: pack.dashboardKpis,
    allocationStrategy: pack.allocationStrategy,
    expiryBlocking: pack.expiryBlocking,
    modules: {
      expiry: !hidden.has('expiry'),
      assets: !hidden.has('assets'),
      jobs: !hidden.has('jobs'),
      catalog: true,
      purchaseOrders: true,
    },
    categories: pack.categories,
    units: pack.units,
    variantFields: pack.variantFields ?? [],
    serialFieldNames: pack.serialFieldNames ?? [],
  };
}

// The workflow (allocation strategy FEFO/FIFO, expiry blocking) is per company. It used to be one process-wide
// value, so the Admin of any company who changed their industry changed how stock is allocated and blocked for
// every company. A company that has not configured one gets the neutral default, never another company's.
const DEFAULT_WORKFLOW_COMPANY = 'default-company';
const workflowsByCompany = new Map<string, ActiveWorkflow>();
const NEUTRAL_WORKFLOW: ActiveWorkflow = workflowFromPack(INDUSTRY_PACKS.grocery);

export function getActiveWorkflow(companyId: string = DEFAULT_WORKFLOW_COMPANY): ActiveWorkflow {
  if (companyId === DEFAULT_WORKFLOW_COMPANY) return { ...activeWorkflow };
  return { ...(workflowsByCompany.get(companyId) ?? NEUTRAL_WORKFLOW) };
}

export function setActiveWorkflow(update: ActiveWorkflow, companyId: string = DEFAULT_WORKFLOW_COMPANY): ActiveWorkflow {
  if (companyId === DEFAULT_WORKFLOW_COMPANY) activeWorkflow = { ...update };
  else workflowsByCompany.set(companyId, { ...update });
  return getActiveWorkflow(companyId);
}

export function workflowFromPack(pack: IndustryPack): ActiveWorkflow {
  return {
    allocationStrategy: pack.allocationStrategy,
    expiryBlocking: pack.expiryBlocking,
    fefoEnforced: pack.allocationStrategy === 'FEFO',
    industryKey: pack.key,
  };
}

export function missingPackSeeds<T extends { name: string }>(existingNames: Iterable<string>, seeds: T[]): T[] {
  const seen = new Set([...existingNames].map((name) => name.trim().toLowerCase()));
  return seeds.filter((seed) => !seen.has(seed.name.trim().toLowerCase()));
}

export function isSerialFieldName(fieldName: string, pack = getIndustryPack(activeWorkflow.industryKey)): boolean {
  const haystack = fieldName.trim().toLowerCase();
  if (pack.serialFieldNames?.some((name) => name.toLowerCase() === haystack)) return true;
  return /imei|serial/.test(haystack);
}

export async function applyIndustryPack(industryKey: IndustryKey, companyId: string = 'default-company'): Promise<{ createdTags: number; createdFields: number }> {
  const pack = getIndustryPack(industryKey);
  setActiveWorkflow(workflowFromPack(pack), companyId);
  if (!databaseEnabled) return { createdTags: 0, createdFields: 0 };

  const [existingTags, existingFields] = await Promise.all([
    prisma.tag.findMany({ where: { companyId }, select: { name: true } }),
    prisma.customFieldDefinition.findMany({ where: { companyId }, select: { name: true } }),
  ]);

  const tagsToCreate = missingPackSeeds(existingTags.map((row) => row.name), pack.tags);
  const fieldsToCreate = missingPackSeeds(existingFields.map((row) => row.name), pack.customFields);

  if (tagsToCreate.length) {
    await prisma.tag.createMany({
      data: tagsToCreate.map((tag) => ({ id: randomUUID(), name: tag.name, companyId, color: tag.color })),
      skipDuplicates: true,
    });
  }

  for (const [index, field] of fieldsToCreate.entries()) {
    await prisma.customFieldDefinition.create({
      data: {
        id: randomUUID(),
        name: field.name,
        companyId,
        type: field.type,
        options: field.options,
        required: Boolean(field.required),
        sortOrder: existingFields.length + index,
      },
    });
  }

  await prisma.workflowConfiguration.upsert({
    where: { type_scopeId: { type: 'INVENTORY', scopeId: 'default' } },
    update: {
      fefoEnforced: pack.allocationStrategy === 'FEFO',
      expiryBlocking: pack.expiryBlocking,
      config: {
        industryKey: pack.key,
        allocationStrategy: pack.allocationStrategy,
      },
    },
    create: {
      id: randomUUID(),
      type: 'INVENTORY',
      scopeId: 'default',
      fefoEnforced: pack.allocationStrategy === 'FEFO',
      expiryBlocking: pack.expiryBlocking,
      config: {
        industryKey: pack.key,
        allocationStrategy: pack.allocationStrategy,
      },
    },
  }).catch(() => undefined);

  for (const moduleName of ['expiry', 'assets', 'jobs'] as const) {
    const enabled = !pack.hide.includes(moduleName);
    await prisma.featureFlag.upsert({
      where: { name: `module.${moduleName}` },
      update: { enabled, config: { industryKey: pack.key } },
      create: {
        id: randomUUID(),
        name: `module.${moduleName}`,
        enabled,
        description: `${pack.label} ${moduleName} module`,
        config: { industryKey: pack.key },
      },
    }).catch(() => undefined);
  }

  return { createdTags: tagsToCreate.length, createdFields: fieldsToCreate.length };
}

export async function hydrateActiveWorkflow(industryKey?: string | null): Promise<ActiveWorkflow> {
  const pack = getIndustryPack(industryKey);
  const fallback = workflowFromPack(pack);
  if (!databaseEnabled) {
    return setActiveWorkflow(fallback);
  }
  const row = await prisma.workflowConfiguration.findUnique({
    where: { type_scopeId: { type: 'INVENTORY', scopeId: 'default' } },
  }).catch(() => null);
  if (!row) return setActiveWorkflow(fallback);
  return setActiveWorkflow({
    allocationStrategy: pack.allocationStrategy,
    expiryBlocking: pack.expiryBlocking,
    fefoEnforced: pack.allocationStrategy === 'FEFO',
    industryKey: pack.key,
  });
}
