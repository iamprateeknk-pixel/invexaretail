import { DomainError } from '../errors.js';
import { issueOfflinePermit, verifyOfflinePermit, type OfflinePermitScope } from '../otp-auth.js';
import type { Prisma } from '@prisma/client';
import type { TenantContext } from '../tenant-context.js';
import { controlPlane, type MobilePolicy } from './control-plane.js';
import { readStudioRuntime } from './studio-versions.js';

function permitLifetime(policy: MobilePolicy | undefined, scope: OfflinePermitScope): number {
  if (!Array.isArray(policy?.syncScope) || !policy.syncScope.includes(scope) || !Number.isFinite(policy.offlineMaxHours)) return 0;
  return Math.floor(Math.max(0, Math.min(policy.offlineMaxHours, 8_760)) * 3_600);
}

export const WAREHOUSE_OFFLINE_SCOPES = ['picks', 'receiving', 'putaway'] as const;

export function issueMobilePermit(caller: Pick<TenantContext, 'companyId' | 'userId' | 'role'>, policy: MobilePolicy | undefined, scope: OfflinePermitScope) {
  const lifetime = permitLifetime(policy, scope);
  return lifetime > 0 ? issueOfflinePermit(caller.userId, caller.companyId, caller.role, lifetime, scope) : undefined;
}

export async function enforceMobilePermit(ctx: TenantContext, token: string, scope: OfflinePermitScope, db?: Prisma.TransactionClient): Promise<void> {
  const count = scope === 'counts';
  const rejected = () => new DomainError(count ? 'OFFLINE_COUNT_POLICY_REJECTED' : 'OFFLINE_WAREHOUSE_POLICY_REJECTED',
    count ? 'This saved count is outside your current offline permission. Refresh the task and count again.'
      : 'This saved warehouse action is outside your current offline permission. Refresh the task and scan again.');
  const issuedAt = verifyOfflinePermit(token, ctx, scope);
  if (issuedAt === null) throw rejected();
  const runtime = await readStudioRuntime(controlPlane, ctx.companyId, ctx.role, db).catch(() => {
    throw new DomainError(count ? 'OFFLINE_COUNT_POLICY_UNAVAILABLE' : 'OFFLINE_WAREHOUSE_POLICY_UNAVAILABLE',
      'Could not check offline permission. Retry when the service is available.');
  });
  if (Math.floor(Date.now() / 1_000) >= issuedAt + permitLifetime(runtime.mobilePolicy, scope)) throw rejected();
}
