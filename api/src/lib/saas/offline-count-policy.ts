import { DomainError } from '../errors.js';
import { issueOfflineCountPermit, verifyOfflineCountPermit } from '../otp-auth.js';
import type { TenantContext } from '../tenant-context.js';
import { controlPlane, type MobilePolicy } from './control-plane.js';
import { readStudioRuntime } from './studio-versions.js';

function countPermitLifetime(policy: MobilePolicy | undefined): number {
  if (!policy?.syncScope?.includes('counts') || !Number.isFinite(policy.offlineMaxHours)) return 0;
  return Math.floor(Math.max(0, Math.min(policy.offlineMaxHours, 8_760)) * 3_600);
}

export function issueCountPermit(caller: Pick<TenantContext, 'companyId' | 'userId' | 'role'>, policy: MobilePolicy | undefined) {
  const lifetime = countPermitLifetime(policy);
  return lifetime > 0 ? issueOfflineCountPermit(caller.userId, caller.companyId, caller.role, lifetime) : undefined;
}

export async function enforceOfflineCountPolicy(ctx: TenantContext, token: string): Promise<void> {
  const rejected = () => new DomainError('OFFLINE_COUNT_POLICY_REJECTED',
    'This saved count is outside your current offline permission. Refresh the task and count again.');
  const issuedAt = verifyOfflineCountPermit(token, ctx);
  if (issuedAt === null) throw rejected();
  const runtime = await readStudioRuntime(controlPlane, ctx.companyId, ctx.role).catch(() => {
    throw new DomainError('OFFLINE_COUNT_POLICY_UNAVAILABLE', 'Could not check offline count permission. Retry when the service is available.');
  });
  if (Math.floor(Date.now() / 1_000) >= issuedAt + countPermitLifetime(runtime.mobilePolicy)) throw rejected();
}
