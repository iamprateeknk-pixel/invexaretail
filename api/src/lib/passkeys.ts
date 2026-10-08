// Passkeys (WebAuthn) relying-party configuration and ceremonies. All cryptographic verification is done by
// @simplewebauthn/server (AGENTS.md: no custom crypto); this module only configures it. The server's challenge
// travels in a short-lived signed token (see signPasskeyCeremony in otp-auth.ts).
import {
  generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse,
  type AuthenticationResponseJSON, type AuthenticatorTransportFuture, type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import type { PasskeyRecord } from './passkey-store.js';

export type PasskeyConfig = { rpID: string; rpName: string; origins: string[] };

/** Null (not configured) until WEBAUTHN_RP_ID and WEBAUTHN_ORIGINS are set: passkeys are bound to the web origin. */
export function passkeyConfig(env: NodeJS.ProcessEnv = process.env): PasskeyConfig | null {
  const rpID = env.WEBAUTHN_RP_ID?.trim();
  const origins = (env.WEBAUTHN_ORIGINS ?? '').split(',').map((value) => value.trim()).filter(Boolean);
  if (!rpID || !origins.length) return null;
  return { rpID, rpName: env.WEBAUTHN_RP_NAME?.trim() || 'Invexa Retail', origins };
}

const toTransports = (values: string[]) => values as AuthenticatorTransportFuture[];

export async function registrationOptions(config: PasskeyConfig, user: { id: string; email: string; name: string }, existing: PasskeyRecord[]) {
  return generateRegistrationOptions({
    rpName: config.rpName,
    rpID: config.rpID,
    userName: user.email,
    userDisplayName: user.name,
    userID: new TextEncoder().encode(user.id),
    attestationType: 'none',
    excludeCredentials: existing.map((row) => ({ id: row.credentialId, transports: toTransports(row.transports) })),
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
  });
}

export async function verifyRegistration(config: PasskeyConfig, response: RegistrationResponseJSON, expectedChallenge: string) {
  return verifyRegistrationResponse({
    response, expectedChallenge, expectedOrigin: config.origins, expectedRPID: config.rpID, requireUserVerification: true,
  });
}

export async function authenticationOptions(config: PasskeyConfig, allow: PasskeyRecord[]) {
  return generateAuthenticationOptions({
    rpID: config.rpID,
    userVerification: 'required',
    // Empty means a discoverable-credential prompt; otherwise limited to this account's keys.
    allowCredentials: allow.map((row) => ({ id: row.credentialId, transports: toTransports(row.transports) })),
  });
}

export async function verifyAuthentication(config: PasskeyConfig, response: AuthenticationResponseJSON, expectedChallenge: string, passkey: PasskeyRecord) {
  return verifyAuthenticationResponse({
    response, expectedChallenge, expectedOrigin: config.origins, expectedRPID: config.rpID, requireUserVerification: true,
    credential: {
      id: passkey.credentialId, publicKey: passkey.publicKey as Uint8Array<ArrayBuffer>, counter: passkey.counter,
      transports: toTransports(passkey.transports),
    },
  });
}
