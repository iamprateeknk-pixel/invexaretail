const mysql = require('mysql2/promise');

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is mandatory for a production deploy.');
  const parsed = new URL(url);
  if (!/^mysql/.test(parsed.protocol)) throw new Error('DATABASE_URL must be a mysql:// URL.');
  const connection = await mysql.createConnection(url);
  try {
    const [health] = await connection.query('SELECT 1 AS ok');
    const [migrations] = await connection.query("SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = '_prisma_migrations'");
    if (!Number(migrations[0]?.count)) throw new Error('Prisma migrations table is missing after migrate deploy.');
    console.log(`Database verified (${health[0]?.ok === 1 ? 'reachable' : 'unexpected health response'}).`);
  } finally {
    await connection.end();
  }
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });