// Linked Control Panel sign-in (Windows app, ADMIN only).
//
// The Control Panel is the platform's own administration: every company, plan and user. A company
// ADMIN is not a platform administrator, so the app never signs one in to it on its role alone.
// Instead a platform administrator links their platform account to one app user, once, by proving
// both identities in the same request: the app user's own signed-in session and the platform
// password. After that, that app user (and only while it stays an active ADMIN of the same
// company) can ask for a one-time code that opens the Control Panel already signed in. Every link,
// unlink and linked sign-in is recorded in the Control Plane audit trail.
//
// Dual-mode like lib/two-factor-store.ts: Postgres in database mode, in memory otherwise.
import { prisma } from '../db.js';
import { databaseEnabled } from '../persistence.js';
import { ControlPlaneError, controlPlane } from './control-plane.js';

export type AppLink = { appUserId: string; platformUserId: string; companyId: string; createdAt: Date };

/** The app user the link is made for: what the API's requireAuth already resolved. */
export type LinkingAppUser = { id: string; companyId: string; role: string; status: string; email?: string };

const memory = new Map<string, AppLink>();

export function resetAppLinksForTest(): void {
  memory.clear();
}

async function load(appUserId: string): Promise<AppLink | null> {
  if (databaseEnabled) {
    return prisma.controlPanelAppLink.findUnique({ where: { appUserId } });
  }
  return memory.get(appUserId) ?? null;
}

/** Only an active company ADMIN may hold a link - the same rule as the app's Control Panel tab. */
function assertEligible(user: LinkingAppUser): void {
  if (user.status !== 'active' || user.role !== 'ADMIN') {
    throw new ControlPlaneError('Only an active ADMIN can use the Control Panel link', 'FORBIDDEN', 403);
  }
}

/**
 * A link that may be used now: same company as when it was made. A user moved to another company
 * loses it, and so does one that is no longer ADMIN (checked by the caller via assertEligible).
 */
async function usableLink(user: LinkingAppUser): Promise<AppLink | null> {
  const link = await load(user.id);
  if (!link || link.companyId !== user.companyId) return null;
  return link;
}

export async function linkStatus(user: LinkingAppUser): Promise<{ linked: boolean; platformEmail?: string }> {
  if (user.status !== 'active' || user.role !== 'ADMIN') return { linked: false };
  const link = await usableLink(user);
  if (!link) return { linked: false };
  const platform = controlPlane.platformUsers.get(link.platformUserId);
  return platform && platform.status === 'active' ? { linked: true, platformEmail: platform.email } : { linked: false };
}

/** Links [user] to the platform account whose credentials are given. Replaces any earlier link. */
export async function linkAppUser(user: LinkingAppUser, email: string, password: string): Promise<{ platformEmail: string }> {
  assertEligible(user);
  const platform = controlPlane.verifyPlatformCredentials(email, password);
  const row: AppLink = { appUserId: user.id, platformUserId: platform.id, companyId: user.companyId, createdAt: new Date() };
  if (databaseEnabled) {
    await prisma.controlPanelAppLink.upsert({
      where: { appUserId: user.id },
      create: row,
      update: { platformUserId: row.platformUserId, companyId: row.companyId, createdAt: row.createdAt },
    });
  } else {
    memory.set(user.id, row);
  }
  controlPlane.auditEvent({
    actorUserId: platform.id,
    actorType: 'platform',
    tenantId: controlPlane.tenantId,
    companyId: user.companyId,
    sessionId: null,
    action: 'APP_LINK_CREATED',
    entityType: 'platform_user',
    entityId: platform.id,
    before: null,
    after: { appUserId: user.id, companyId: user.companyId },
  });
  return { platformEmail: platform.email };
}

export async function unlinkAppUser(user: LinkingAppUser): Promise<{ removed: boolean }> {
  const link = await load(user.id);
  if (!link) return { removed: false };
  if (databaseEnabled) {
    await prisma.controlPanelAppLink.deleteMany({ where: { appUserId: user.id } });
  } else {
    memory.delete(user.id);
  }
  controlPlane.auditEvent({
    actorUserId: user.id,
    actorType: 'company',
    tenantId: controlPlane.tenantId,
    companyId: user.companyId,
    sessionId: null,
    action: 'APP_LINK_REMOVED',
    entityType: 'platform_user',
    entityId: link.platformUserId,
    before: { appUserId: user.id },
    after: null,
  });
  return { removed: true };
}

/** The platform session a linked app user opens the Control Panel with. Throws when not linked. */
export async function linkedPlatformSession(user: LinkingAppUser): Promise<ReturnType<typeof controlPlane.linkedPlatformLogin>> {
  assertEligible(user);
  const link = await usableLink(user);
  if (!link) {
    throw new ControlPlaneError('This account is not linked to a Control Panel account', 'LINK_NOT_FOUND', 404);
  }
  return controlPlane.linkedPlatformLogin(link.platformUserId, user.id);
}
