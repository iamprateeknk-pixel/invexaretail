import { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { STUDIO_REPORT_ROW_LIMIT, type studioReportDefinition } from '../saas/studio-report-config.js';
import type { TenantContext } from '../tenant-context.js';

type Definition = NonNullable<ReturnType<typeof studioReportDefinition>>;
type OrderDataset = 'orders' | 'purchase_orders';
type QueryRow = { reportData: Record<string, string | number | null>; total: bigint };

export async function runStudioOrderReport(
  ctx: TenantContext, locationId: string, dataset: OrderDataset, definition: Definition,
) {
  const { companyId } = ctx;
  const { columns, groupBy, filters, chart } = definition;
  const needsLineCount = columns.some(({ key }) => key === 'lines') || filters.some(([key]) => key === 'lines');
  const lineCount = needsLineCount
    ? Prisma.sql`(SELECT count(*) FROM "OrderLine" AS line WHERE line."orderId" = sale."id")`
    : Prisma.sql`NULL`;
  const source = dataset === 'orders'
    ? Prisma.sql`
        SELECT sale."id", sale."createdAt",
          jsonb_build_object(
            'order_no', coalesce(sale."externalReference", sale."id"), 'channel', sale."channel",
            'status', sale."status", 'lines', ${lineCount},
            'created_at', to_char(sale."createdAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
          ) AS "reportData"
        FROM "Order" AS sale
        WHERE sale."companyId" = ${companyId} AND sale."fulfillmentLocationId" = ${locationId}
      `
    : Prisma.sql`
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
        FROM "matching" ORDER BY "createdAt" DESC, "id" DESC
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
