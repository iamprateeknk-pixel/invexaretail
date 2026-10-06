// Pure helpers for the optional two-factor sign-in step.

/** A sign-in response that is not a session yet: the server wants a second factor. */
export function isTwoFactorChallenge(response) {
  return Boolean(response?.twoFactorRequired && typeof response.challengeToken === 'string' && response.challengeToken);
}

/**
 * Authenticator codes are 6 digits; backup codes look like XXXXX-XXXXX. The
 * server accepts either, so this only trims whitespace and uppercases letters.
 */
export function normalizeTwoFactorCode(input) {
  return String(input ?? '').trim().replace(/\s+/g, '').toUpperCase();
}

export function twoFactorCodeLooksValid(input) {
  const code = normalizeTwoFactorCode(input);
  return /^\d{6}$/.test(code) || /^[A-Z0-9]{5}-?[A-Z0-9]{5}$/.test(code);
}
