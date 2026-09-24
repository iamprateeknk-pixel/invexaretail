# Fix: opening-stock import fails on any row with an expiry date

## The bug

Uploading an opening-stock/lot-quantity file (`Stock update` in the web UI)
through `lib/persistence.ts`'s `persistOpeningStockImport` failed as soon
as any row carried an expiry date:

```
Invalid `prisma.$executeRaw()` invocation: Raw query failed. Code: `42804`.
Message: column "expiryDate" is of type timestamp without time zone but
expression is of type text
```

Reported against a real upload of 8,677 lot rows (the `Confirm 8677 lot
rows` validation screen), but reproducible with a single row.

## Root cause

`persistOpeningStockImport`'s batched lot-expiry update builds a raw SQL
`CASE id WHEN ... THEN ...` statement, one `WHEN`/`THEN` branch per lot in
the chunk:

```ts
await tx.$executeRaw(Prisma.sql`
  UPDATE "Lot" SET "expiryDate" = CASE id
    ${Prisma.join(chunk.map((lot) => Prisma.sql`WHEN ${lot.id} THEN ${new Date(lot.expiryDate!)}`), ' ')}
  END, "updatedAt" = NOW()
  WHERE id IN (${Prisma.join(chunk.map((lot) => Prisma.sql`${lot.id}`))})
`);
```

Each `THEN` value is bound as a query parameter with no explicit SQL type.
Postgres infers a `CASE` expression's result type from its branches, and
with every branch an untyped parameter, it falls back to `text` rather
than the `timestamp without time zone` the `Lot.expiryDate` column
actually is - hence `column ... is of type timestamp ... but expression
is of type text`. This is a real 42804 type-mismatch, not a flake: every
opening-stock upload containing an expiry date failed the same way, every
time.

## The fix

One line: cast each `THEN` value to `::timestamp`, matching the column's
real type, so Postgres has an explicit type for every branch instead of
guessing:

```ts
${Prisma.join(chunk.map((lot) => Prisma.sql`WHEN ${lot.id} THEN ${new Date(lot.expiryDate!)}::timestamp`), ' ')}
```

## Testing

`src/lib/persistence-opening-stock-expiry.postgres.test.ts` (real
Postgres, per AGENTS.md's rule that any change to `lib/persistence.ts`
must be exercised against a real database, not just memory mode):
parses a one-row CSV with an expiry date through `parseStockImport`,
commits it through `persistOpeningStockImport`, and asserts the item, lot,
and lot's `expiryDate` all landed correctly. Verified the test fails with
the exact reported 42804 error before the fix (reverted the cast locally,
confirmed the failure, then restored it) and passes after.

Full `npm test`: 565 passing, 0 failing (the new test correctly skipped in
memory mode - this is a database-mode-only code path). `architecture-lint`:
0 new violations. `contract:validate`/`contract:check-drift`: both pass.

## What's unaffected

The other two `$executeRaw` calls in `persistOpeningStockImport`/
`persistDailyMovementImport` are plain `INSERT ... VALUES` statements with
consistent per-column types across every row, not a `CASE` expression with
per-branch untyped literals - they don't share this bug shape.
`persistDailyMovementImport`'s own expiry-date write goes through
`tx.lot.upsert` (Prisma's typed client, not raw SQL), which was never
affected.
