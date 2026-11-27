import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { DomainError } from '../errors.js';
import { databaseEnabled } from '../persistence.js';
import { requireItemById } from '../repositories/item-repository.js';
import type { TenantContext } from '../tenant-context.js';
import type { FieldDefinition } from './control-plane.js';

const TYPES = ['text', 'number', 'date', 'boolean'] as const;
type FieldType = typeof TYPES[number];
type FieldValue = string | number | boolean | null;
type ItemField = FieldDefinition & { dataType: FieldType };

function validValue(type: FieldType, value: unknown): value is Exclude<FieldValue, null> {
  switch (type) {
    case 'text': return typeof value === 'string' && value.trim().length > 0 && value.length <= 2000;
    case 'number': return typeof value === 'number' && Number.isFinite(value);
    case 'boolean': return typeof value === 'boolean';
    case 'date': {
      if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
      const date = new Date(`${value}T00:00:00.000Z`);
      return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
    }
  }
}

const valueKey = (ctx: TenantContext, itemId: string, field: ItemField) => JSON.stringify([ctx.companyId, 'item', itemId, field.id]);
const allows = (roles: unknown, role: string) => Array.isArray(roles) && roles.includes(role);

async function publishedItemFields(ctx: TenantContext, db: Prisma.TransactionClient) {
  const config = await db.controlPlaneConfig.findFirst({
    where: { companyId: ctx.companyId, kind: 'published', status: 'published' },
    orderBy: [{ version: 'desc' }, { updatedAt: 'desc' }, { versionId: 'asc' }],
    select: { version: true, versionId: true, payload: true },
  });
  const fields = (config?.payload as { fields?: FieldDefinition[] } | null)?.fields ?? [];
  const visible = fields.filter((field): field is ItemField => field.companyId === ctx.companyId && field.entityType === 'item'
    && field.status === 'active' && TYPES.includes(field.dataType as FieldType) && allows(field.visibleRoles, ctx.role));
  return { config, fields: visible };
}

export async function getStudioItemFields(ctx: TenantContext, itemId: string) {
  await requireItemById(ctx, itemId);
  if (!databaseEnabled) return { versionId: null, configVersion: null, fields: [] };
  const { config, fields } = await publishedItemFields(ctx, prisma);
  const rows = fields.length === 0 ? [] : await prisma.controlPlaneFieldValue.findMany({
    where: { key: { in: fields.map((field) => valueKey(ctx, itemId, field)) } },
  });
  const storedValues = new Map(rows.map((row) => [row.key, (row.value as { value?: FieldValue }).value]));
  return {
    versionId: config?.versionId ?? null,
    configVersion: config?.version ?? null,
    fields: fields.map((field) => {
      const stored = storedValues.get(valueKey(ctx, itemId, field));
      const value = stored === undefined ? field.defaultValue : stored;
      return {
        key: field.fieldKey, label: field.label, type: field.dataType, required: field.required,
        editable: allows(field.editableRoles, ctx.role), value: validValue(field.dataType, value) ? value : null,
      };
    }),
  };
}

export async function setStudioItemField(ctx: TenantContext, itemId: string, fieldKey: string, versionId: string, value: unknown) {
  await requireItemById(ctx, itemId);
  if (!databaseEnabled) throw new DomainError('NOT_SUPPORTED', 'Studio item fields need the database.');
  return prisma.$transaction(async (tx) => {
    const { config, fields } = await publishedItemFields(ctx, tx);
    const field = fields.find((entry) => entry.fieldKey === fieldKey);
    if (!field) throw new DomainError('NOT_FOUND', 'Item field was not found.');
    if (!allows(field.editableRoles, ctx.role)) throw new DomainError('FORBIDDEN', 'You cannot edit this item field.');
    if (!config || config.versionId !== versionId) throw new DomainError('CONFLICT', 'Studio item fields changed. Reload the item before saving.');
    if (value === null ? field.required : !validValue(field.dataType, value)) {
      throw new DomainError('VALIDATION_FAILED', `Enter a valid ${field.dataType} value for ${field.label}.`);
    }
    const key = valueKey(ctx, itemId, field);
    const data = { value: value as FieldValue };
    await tx.controlPlaneFieldValue.upsert({ where: { key }, create: { key, value: data }, update: { value: data } });
    await tx.auditLog.create({ data: {
      id: randomUUID(), actorId: ctx.userId, actorRole: ctx.role, action: 'STUDIO_ITEM_FIELD_UPDATED', entityType: 'Item', entityId: itemId,
      metadata: { companyId: ctx.companyId, fieldKey, configVersion: config.version, versionId },
    } });
    return { key: fieldKey, value: data.value, versionId, configVersion: config.version };
  });
}
