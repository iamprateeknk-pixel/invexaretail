const { Client } = require('pg');

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is mandatory for a production deploy.');
  const parsed = new URL(url);
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error('DATABASE_URL must be a postgresql:// URL.');
  }
  const connection = new Client({ connectionString: url });
  await connection.connect();
  try {
    const health = await connection.query('SELECT 1 AS ok');
    const migrations = await connection.query("SELECT to_regclass('public._prisma_migrations') AS table_name");
    if (!migrations.rows[0]?.table_name) throw new Error('Prisma migrations table is missing after migrate deploy.');
    console.log(`Database verified (${health.rows[0]?.ok === 1 ? 'reachable' : 'unexpected health response'}).`);
  } finally {
    await connection.end();
  }
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
