import { prisma } from '../db.js';
import type { Prisma } from '@prisma/client';
import type { ConfigurationVersion, ControlPlane } from './control-plane.js';
import { controlPlaneDbEnabled, stableStringify } from './control-plane-repository.js';
import { validateStudioRelease } from './control-plane-studio.js';

export async function readStudioRuntime(plane: ControlPlane, companyId: string, role: string,
  db: Pick<Prisma.TransactionClient, 'controlPlaneConfig'> = prisma) {
  if (!controlPlaneDbEnabled()) return plane.runtimeConfig(companyId, role);
  const current = await db.controlPlaneConfig.findFirst({
    where: { companyId, kind: 'published', status: 'published' },
    orderBy: [{ version: 'desc' }, { updatedAt: 'desc' }, { versionId: 'asc' }],
    select: { payload: true },
  });
  return plane.runtimeConfig(companyId, role, current ? current.payload as unknown as ConfigurationVersion : null);
}

/** The active and historical records are read together so the comparison pins one active version. */
export async function readStudioVersions(plane: ControlPlane, companyId: string) {
  if (!controlPlaneDbEnabled()) {
    return { active: plane.published.get(companyId), versions: [...(plane.versions.get(companyId) ?? [])].sort((a, b) => b.version - a.version) };
  }
  const rows = await prisma.controlPlaneConfig.findMany({
    where: { companyId, status: 'published', kind: { in: ['published', 'history'] } },
    orderBy: [{ version: 'desc' }, { updatedAt: 'desc' }, { versionId: 'asc' }],
    select: { kind: true, payload: true },
  });
  const parse = (row: typeof rows[number]) => row.payload as unknown as ConfigurationVersion;
  const published = rows.find((row) => row.kind === 'published');
  return { active: published ? parse(published) : undefined, versions: rows.filter((row) => row.kind === 'history').map(parse) };
}

export function describeStudioVersion(plane: ControlPlane, version: ConfigurationVersion, activeId?: string) {
  let blockedReason: string | null = null;
  try {
    validateStudioRelease(version);
  } catch (error) {
    blockedReason = error instanceof Error ? error.message : 'This version is incompatible with the current Studio configuration.';
  }
  return {
    id: version.id, version: version.version, publishedAt: version.publishedAt,
    author: plane.platformUsers.get(version.authorId)?.name ?? (version.authorId === 'system' ? 'System' : version.authorId),
    canRestore: Boolean(activeId && activeId !== version.id && !blockedReason), blockedReason,
  };
}

const AREAS = {
  page: 'Stock layout', fields: 'Custom fields', modules: 'Modules', workflows: 'Workflows and approvals',
  rules: 'Rules', reports: 'Reports', automations: 'Automations', mobilePolicies: 'Mobile policies',
} satisfies Partial<Record<keyof ConfigurationVersion, string>>;

export function compareStudioVersions(active: ConfigurationVersion, target: ConfigurationVersion) {
  return (Object.keys(AREAS) as (keyof typeof AREAS)[])
    .filter((key) => stableStringify(active[key]) !== stableStringify(target[key]))
    .map((key) => AREAS[key]);
}

export function studioReviewChanges(active: ConfigurationVersion | undefined, draft: ConfigurationVersion) {
  return (Object.keys(AREAS) as (keyof typeof AREAS)[])
    .filter((key) => stableStringify(active?.[key]) !== stableStringify(draft[key]))
    .map((key) => ({ area: AREAS[key], before: active?.[key] ?? null, after: draft[key] ?? null }));
}
