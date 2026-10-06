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
