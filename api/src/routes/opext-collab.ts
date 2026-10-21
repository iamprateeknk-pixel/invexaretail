// Comments + notification-inbox routes for operations-extension
// (Phase 4): extracted verbatim from operations-extension.ts; the
// composer mounts this router at the cluster's original position.
import { type Request, type Response, Router } from 'express';
import { prisma } from '../lib/db.js';
import { DEFAULT_COMPANY_ID } from '../lib/saas/tenant-scope.js';

const router = Router();

// P0-SEC-003: comments are company scoped, only known entity types are accepted, and the
// entity must belong to the caller's company (a foreign entity id is indistinguishable from a
// missing one). Add a resolver here when a new entity type gets a comment thread.
const COMMENT_ENTITY_RESOLVERS: Record<string, (companyId: string, entityId: string) => Promise<boolean>> = {
  item: async (companyId, id) => Boolean(await prisma.item.findFirst({ where: { id, companyId }, select: { id: true } })),
  lot: async (companyId, id) => Boolean(await prisma.lot.findFirst({ where: { id, item: { companyId } }, select: { id: true } })),
  location: async (companyId, id) => Boolean(await prisma.location.findFirst({ where: { id, companyId }, select: { id: true } })),
  transfer: async (companyId, id) => Boolean(await prisma.transfer.findFirst({ where: { id, companyId }, select: { id: true } })),
  order: async (companyId, id) => Boolean(await prisma.order.findFirst({ where: { id, companyId }, select: { id: true } })),
  count: async (companyId, id) => Boolean(await prisma.stockCount.findFirst({ where: { id, companyId }, select: { id: true } })),
  exception: async (companyId, id) => Boolean(await prisma.exceptionCase.findFirst({ where: { id, companyId }, select: { id: true } })),
  'purchase-order': async (companyId, id) => Boolean(await prisma.purchaseOrder.findFirst({ where: { id, companyId }, select: { id: true } })),
};

async function resolveCommentTarget(req: Request, res: Response): Promise<{ companyId: string; entityType: string; entityId: string } | null> {
  const companyId = req.companyId ?? DEFAULT_COMPANY_ID;
  const entityType = String(req.params.entityType);
  const entityId = String(req.params.entityId);
  const resolver = COMMENT_ENTITY_RESOLVERS[entityType];
  if (!resolver) {
    res.status(400).json({ message: `Comments are not available for "${entityType}".` });
    return null;
  }
  if (!(await resolver(companyId, entityId))) {
    res.status(404).json({ message: 'Record not found.' });
    return null;
  }
  return { companyId, entityType, entityId };
}

router.get('/comments/:entityType/:entityId', async (req, res) => {
  const target = await resolveCommentTarget(req, res);
  if (!target) return;
  const comments = await prisma.contextComment.findMany({
    where: { companyId: target.companyId, entityType: target.entityType, entityId: target.entityId },
    orderBy: { createdAt: 'asc' },
  });
  return res.json({ comments });
});

router.post('/comments/:entityType/:entityId', async (req, res) => {
  const body = typeof req.body.body === 'string' ? req.body.body.trim() : '';
  if (!body) return res.status(400).json({ message: 'Comment cannot be empty.' });
  const target = await resolveCommentTarget(req, res);
  if (!target) return;
  const mentions = [...body.matchAll(/@([\w.-]+)/g)].map((match) => match[1]);
  const comment = await prisma.contextComment.create({ data: {
    companyId: target.companyId,
    entityType: target.entityType,
    entityId: target.entityId,
    authorId: req.user!.id,
    authorName: req.user!.name || req.user!.email || req.user!.id,
    body,
    mentions,
  } });
  return res.status(201).json({ comment });
});

// P0-SEC-004: the inbox is company scoped. Role-wide and global (no user, no role) notices used
// to be visible to every company.
router.get('/notification-inbox', async (req, res) => {
  const notifications = await prisma.userNotification.findMany({
    where: {
      companyId: req.companyId ?? DEFAULT_COMPANY_ID,
      OR: [{ userId: req.user!.id }, { role: req.user!.role }, { userId: null, role: null }],
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  return res.json({ notifications });
});

router.patch('/notification-inbox/:id/read', async (req, res) => {
  const notice = await prisma.userNotification.findFirst({ where: { id: req.params.id, companyId: req.companyId ?? DEFAULT_COMPANY_ID } });
  if (!notice || (notice.userId && notice.userId !== req.user!.id) || (notice.role && notice.role !== req.user!.role)) {
    return res.status(404).json({ message: 'Notification not found.' });
  }
  const notification = await prisma.userNotification.update({ where: { id: notice.id, companyId: notice.companyId }, data: { readAt: new Date() } });
  return res.json({ notification });
});

export default router;
