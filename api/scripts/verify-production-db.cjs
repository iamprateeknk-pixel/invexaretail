const { Client } = require('pg');

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is mandatory for a production deploy.');
  const parsed = new URL(url);
  if (!/^postgres(ql)?:$/.test(parsed.protocol)) throw new Error('DATABASE_URL must be a postgresql:// URL.');
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const health = await client.query('SELECT 1 AS ok');
    const migrations = await client.query("SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = '_prisma_migrations'");
    if (!Number(migrations.rows[0]?.count)) throw new Error('Prisma migrations table is missing after migrate deploy.');
    // Deploy gate for migration 20270119090000_drop_stock_balance: the legacy
    // StockBalance table may only be dropped once it holds no rows. Any
    // remaining balances must first be exported via the OPENING_STOCK export
    // and reconciled to zero; silently dropping live balances is not allowed.
    const stockBalanceTable = await client.query("SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'StockBalance'");
    if (Number(stockBalanceTable.rows[0]?.count)) {
      const stockBalanceRows = await client.query('SELECT COUNT(*) AS count FROM "StockBalance"');
      const remaining = Number(stockBalanceRows.rows[0]?.count);
      if (remaining > 0) throw new Error(`StockBalance still holds ${remaining} row(s). Export the remaining balances via the OPENING_STOCK export and reconcile them to zero before deploying the StockBalance drop migration.`);
    }
    console.log(`Database verified (${health.rows[0]?.ok === 1 ? 'reachable' : 'unexpected health response'}).`);
  } finally {
    await client.end();
  }
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
