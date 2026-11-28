import { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { canAccessLocation } from '../inventory.js';
import { seesInactiveItems } from '../item-master.js';
import { LOT_COST_DECIMAL_PATTERN, LOT_COST_FIELDS, LOT_COST_TEXT_LIMIT, LOT_COST_WHITESPACE, MAX_FINITE_DECIMAL } from '../lot-cost.js';
import { STUDIO_REPORT_ROW_LIMIT, type StudioReportDataset, type studioReportDefinition } from '../saas/studio-report-config.js';
import type { TenantContext } from '../tenant-context.js';

type Definition = NonNullable<ReturnType<typeof studioReportDefinition>>;
type QueryRow = { reportData: Record<string, string | number | null>; total: bigint };

function recordedLotCost(field: typeof LOT_COST_FIELDS[number]) {
  const text = Prisma.sql`btrim(lot."attributes" ->> ${field}::text, ${LOT_COST_WHITESPACE}::text)`;
  return Prisma.sql`
    (SELECT parsed.cost FROM (
      SELECT CASE WHEN length(${text}) <= ${LOT_COST_TEXT_LIMIT} AND ${text} ~ ${LOT_COST_DECIMAL_PATTERN}
        THEN (${text})::numeric END AS cost
    ) AS parsed WHERE parsed.cost > 0 AND parsed.cost <= ${MAX_FINITE_DECIMAL}::numeric)
  `;
}

function reportSource(ctx: TenantContext, locationId: string, dataset: StudioReportDataset, fields: Set<string>, assignedLocationIds: string[]) {
  const { companyId } = ctx;
  switch (dataset) {
    case 'orders': {
      const lineCount = fields.has('lines')
        ? Prisma.sql`(SELECT count(*) FROM "OrderLine" AS line WHERE line."orderId" = sale."id")`
        : Prisma.sql`NULL`;
      return Prisma.sql`
        SELECT sale."id", sale."createdAt",
          jsonb_build_object(
            'order_no', coalesce(sale."externalReference", sale."id"), 'channel', sale."channel",
            'status', sale."status", 'lines', ${lineCount},
            'created_at', to_char(sale."createdAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
          ) AS "reportData"
        FROM "Order" AS sale
        WHERE sale."companyId" = ${companyId} AND sale."fulfillmentLocationId" = ${locationId}
      `;
    }
    case 'purchase_orders':
      return Prisma.sql`
        SELECT purchase."id", purchase."createdAt",
          jsonb_build_object(
            'po_no', purchase."number", 'supplier', supplier."name", 'status', purchase."status",
            'expected_at', to_char(purchase."expectedAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
            'value', purchase."totalAmount"
          ) AS "reportData"
        FROM "PurchaseOrder" AS purchase
        LEFT JOIN "Supplier" AS supplier ON supplier."id" = purchase."supplierId"
          AND supplier."companyId" = purchase."companyId"
        WHERE purchase."companyId" = ${companyId} AND purchase."locationId" = ${locationId}
      `;
    case 'inventory': {
      const hasValue = fields.has('value');
      const hasLot = fields.has('lot_no') || hasValue;
      const lotJoin = hasLot ? Prisma.sql`
        LEFT JOIN "Lot" AS lot ON lot."id" = ledger."lotId" AND lot."itemId" = item."id"
      ` : Prisma.empty;
      const valuation = hasValue ? Prisma.sql`
        LEFT JOIN LATERAL (
          SELECT round(ledger."onHand" * coalesce(${Prisma.join(LOT_COST_FIELDS.map(recordedLotCost))}), 2) AS amount
        ) AS valuation ON TRUE
      ` : Prisma.empty;
      const value = hasValue
        ? Prisma.sql`CASE WHEN abs(valuation.amount) <= ${MAX_FINITE_DECIMAL}::numeric THEN valuation.amount END`
        : Prisma.sql`NULL`;
      return Prisma.sql`
        SELECT ledger."itemId", ledger."lotId",
          jsonb_build_object(
            'item_code', concat_ws(' · ', nullif(item."code", ''), nullif(item."name", '')),
            'lot_no', ${hasLot ? Prisma.sql`lot."lotNo"` : Prisma.sql`NULL`}, 'category', item."category", 'company', item."company",
            'physical', ledger."onHand", 'book', ledger."onHand", 'variance', 0, 'value', ${value},
            'reserved', ledger."reserved", 'quarantine', ledger."quarantine",
            'available', greatest(0, ledger."onHand" - ledger."reserved")
          ) AS "reportData"
        FROM (
          SELECT "itemId", "lotId", "companyId", "locationId", "onHand", "reserved", "quarantine" FROM "StockLedger"
        ) AS ledger
        JOIN "Item" AS item ON item."id" = ledger."itemId" AND item."companyId" = ledger."companyId"
        ${lotJoin}
        ${valuation}
        WHERE ledger."companyId" = ${companyId} AND ledger."locationId" = ${locationId}
          AND (${seesInactiveItems(ctx.role)}::boolean OR item."status" = 'ACTIVE')
      `;
    }
    case 'counts':
      return Prisma.sql`
        SELECT counted."id", counted."createdAt",
          jsonb_build_object(
            'item_code', concat_ws(' · ', nullif(item."code", ''), nullif(item."name", '')),
            'counted', counted."physicalQty", 'book', counted."bookQty",
            'variance', counted."physicalQty" - counted."bookQty", 'counted_by', counted."submittedById",
            'status', CASE counted."reviewStatus"
              WHEN 'APPROVED' THEN 'Approved' WHEN 'Approved' THEN 'Approved'
              WHEN 'REJECTED' THEN 'Rejected' WHEN 'Rejected' THEN 'Rejected'
              WHEN 'RECOUNT' THEN 'Recount' WHEN 'Recount' THEN 'Recount'
              WHEN 'ASSIGNED' THEN 'Assigned' WHEN 'Assigned' THEN 'Assigned'
              ELSE 'Pending review' END
          ) AS "reportData"
        FROM "StockCount" AS counted
        JOIN "Item" AS item ON item."id" = counted."itemId" AND item."companyId" = counted."companyId"
        WHERE counted."companyId" = ${companyId} AND counted."locationId" = ${locationId}
      `;
    case 'transfers': {
      const itemCount = fields.has('items')
        ? Prisma.sql`(SELECT count(DISTINCT line."itemId") FROM "TransferLine" AS line WHERE line."transferId" = transfer."id")`
        : Prisma.sql`NULL`;
      const allLocations = canAccessLocation({ role: ctx.role, assignedLocationIds: [] }, locationId);
      const visible = allLocations ? Prisma.empty : Prisma.sql`AND "id" = ANY(${assignedLocationIds}::text[])`;
      const locations = Prisma.sql`
        SELECT "id", "name" FROM "Location" WHERE "companyId" = ${companyId} ${visible}
      `;
      // Keep receiving visibility at the selected location. Counterparty names have the same scope as the location list.
      return Prisma.sql`
        SELECT transfer."id", transfer."createdAt",
          jsonb_build_object(
            'transfer_no', transfer."id", 'from', origin."name", 'to', destination."name",
            'status', transfer."status", 'items', ${itemCount},
            'created_at', to_char(transfer."createdAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
          ) AS "reportData"
        FROM "Transfer" AS transfer
        JOIN "Location" AS selected ON selected."id" = ${locationId} AND selected."companyId" = ${companyId}
        LEFT JOIN (${locations}) AS origin ON origin."id" = transfer."sourceLocationId"
        LEFT JOIN (${locations}) AS destination ON destination."id" = transfer."destinationLocationId"
        WHERE (transfer."companyId" = selected."companyId" AND transfer."sourceLocationId" = selected."id")
          OR transfer."destinationLocationId" = selected."id"
      `;
    }
  }
}

export async function runStudioReport(
  ctx: TenantContext, locationId: string, dataset: StudioReportDataset, definition: Definition, assignedLocationIds: string[],
) {
  const { columns, groupBy, filters, chart } = definition;
  const fields = new Set([...columns.map(({ key }) => key), ...filters.map(([key]) => key)]);
  const source = reportSource(ctx, locationId, dataset, fields, assignedLocationIds);
  const order = dataset === 'inventory' ? Prisma.sql`"itemId", "lotId"`
    : dataset === 'counts' || dataset === 'transfers' ? Prisma.sql`"createdAt", "id"`
      : Prisma.sql`"createdAt" DESC, "id" DESC`;
  // Both the field name and the typed value are parameters. No configuration text becomes SQL.
  const conditions = filters.map(([key, value]) =>
    Prisma.sql`("reportData" -> ${key}::text) = ${JSON.stringify(value)}::jsonb`);
  const matches = conditions.length ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}` : Prisma.empty;
  const select = groupBy
    ? Prisma.sql`
        SELECT jsonb_build_object(${groupBy}::text, "label", 'records', "records") AS "reportData",
          count(*) OVER () AS "total"
        FROM (
          SELECT coalesce("reportData" ->> ${groupBy}::text, '') AS "label", count(*) AS "records"
          FROM "matching" GROUP BY 1
        ) AS groups
        ORDER BY "records" DESC, "label" COLLATE "C"
      `
    : Prisma.sql`
        SELECT "reportData", count(*) OVER () AS "total"
        FROM "matching" ORDER BY ${order}
      `;
  const records = await prisma.$queryRaw<QueryRow[]>`
    WITH "sourceRows" AS (${source}), "matching" AS (SELECT * FROM "sourceRows" ${matches})
    ${select} LIMIT ${STUDIO_REPORT_ROW_LIMIT}
  `;
  const total = Number(records[0]?.total ?? 0);
  return {
    columns, groupBy: groupBy ?? null, chart, total, truncated: total > STUDIO_REPORT_ROW_LIMIT,
    rows: records.map(({ reportData }) =>
      Object.fromEntries(columns.map(({ key, label }) => [label, reportData[key] ?? '']))),
  };
}
