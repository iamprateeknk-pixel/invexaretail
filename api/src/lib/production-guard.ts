// Phase 7: refuse to run in production with secrets that are missing or are a
// known placeholder. Several modules fall back to a constant when JWT_SECRET is
// unset (fine for local development); in production that would mean tokens,
// signed download links, webhook payload encryption and OTP hashes all keyed by
// a string that is public in the repository.
export const KNOWN_PLACEHOLDER_SECRETS = [
  'dev-secret-key-change-in-production',
  'dev-secret-change-me',
  'dev-secret-change-in-production',
  'dev-otp-pepper-change-in-production',
  'change-this-in-production',
  'changeme',
  'change-me',
  'secret',
  'password',
];

export const KNOWN_DEFAULT_PASSWORDS = ['ChangeMe123!'];

export const MIN_SECRET_LENGTH = 16;
export const RECOMMENDED_SECRET_LENGTH = 32;

export type ProductionGuardResult = { ok: boolean; errors: string[]; warnings: string[] };

/**
 * Mirrors lib/db.ts resolveDatabaseUrl() against an explicit env record, so
 * the production guard stays testable without touching process.env. Only the
 * presence of a resolvable URL matters here, not its value.
 */
function databaseConfiguredIn(env: Record<string, string | undefined>): boolean {
  if (env.DATABASE_URL?.trim()) return true;
  const host = (env.PGHOST || env.DB_HOST || '').trim();
  const user = (env.PGUSER || env.DB_USER || '').trim();
  const database = (env.PGDATABASE || env.DB_NAME || '').trim();
  return Boolean(host && user && database);
}

export function checkProductionSecrets(env: Record<string, string | undefined> = process.env): ProductionGuardResult {
  const result: ProductionGuardResult = { ok: true, errors: [], warnings: [] };
  if (env.NODE_ENV !== 'production') return result;

  const jwt = env.JWT_SECRET?.trim() ?? '';
  if (!jwt) {
    result.errors.push('JWT_SECRET is not set. Access tokens, signed links and webhook encryption need a real secret.');
  } else if (KNOWN_PLACEHOLDER_SECRETS.includes(jwt.toLowerCase())) {
    result.errors.push('JWT_SECRET is a placeholder value that is public in the source code. Generate a random one.');
  } else if (jwt.length < MIN_SECRET_LENGTH) {
    result.errors.push(`JWT_SECRET is shorter than ${MIN_SECRET_LENGTH} characters.`);
  } else if (jwt.length < RECOMMENDED_SECRET_LENGTH) {
    result.warnings.push(`JWT_SECRET is shorter than the recommended ${RECOMMENDED_SECRET_LENGTH} characters.`);
  }

  const pepper = env.OTP_PEPPER?.trim();
  if (pepper && KNOWN_PLACEHOLDER_SECRETS.includes(pepper.toLowerCase())) {
    result.errors.push('OTP_PEPPER is a placeholder value that is public in the source code.');
  }

  const seed = env.SEED_PASSWORD?.trim();
  if (seed && KNOWN_DEFAULT_PASSWORDS.includes(seed)) {
    result.errors.push('SEED_PASSWORD is the well-known default. Seeded accounts would be open to anyone who has read the repository.');
  }

  // R9: production must never boot in the in-memory demo mode by accident.
  // Until now the database was only mandatory when someone remembered to set
  // REQUIRE_DATABASE=true, so a production deploy that lost its DATABASE_URL
  // silently degraded to seeded in-memory state. Production now fails closed
  // by default; REQUIRE_DATABASE=false is the explicit opt-out, meant only
  // for throwaway demo deployments.
  if (env.REQUIRE_DATABASE === 'false') {
    result.warnings.push('REQUIRE_DATABASE=false: this production process may boot without a database (in-memory demo mode).');
  } else if (!databaseConfiguredIn(env)) {
    result.errors.push('No database is configured (DATABASE_URL, or the PG*/DB* parts, are missing). Production refuses to boot in in-memory demo mode; set DATABASE_URL or, for an explicit demo only, REQUIRE_DATABASE=false.');
  }

  result.ok = result.errors.length === 0;
  return result;
}

/** Throws with every problem listed, so one failed deploy shows the whole fix list. */
export function assertProductionSecrets(env: Record<string, string | undefined> = process.env): void {
  const result = checkProductionSecrets(env);
  for (const warning of result.warnings) console.warn(`[security] ${warning}`);
  if (!result.ok) {
    throw new Error(`Unsafe production configuration:\n- ${result.errors.join('\n- ')}`);
  }
}

export function isKnownDefaultPassword(password: string): boolean {
  return KNOWN_DEFAULT_PASSWORDS.includes(password);
}
