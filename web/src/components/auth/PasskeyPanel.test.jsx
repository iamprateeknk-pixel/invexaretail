import assert from 'node:assert/strict';
import test from 'node:test';
import 'global-jsdom/register';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import React from 'react';
import { PasskeyPanel } from './PasskeyPanel.jsx';
import { LoginCard } from './LoginCard.jsx';

// sonner's Toaster (inside LoginCard) reads matchMedia, which jsdom does not provide.
globalThis.window.matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });

test.afterEach(() => { cleanup(); delete globalThis.fetch; });

function stubApi(state) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const path = String(url).replace(/^https?:\/\/[^/]+/, '');
    const method = init.method ?? 'GET';
    calls.push({ path, method, body: init.body });
    const json = (body) => ({ ok: true, status: 200, json: async () => body });
    if (path.endsWith('/auth/passkeys') && method === 'GET') return json(state);
    if (path.endsWith('/passkeys/register/options')) return json({ options: { challenge: 'abc' }, challengeToken: 'tok-1' });
    if (path.endsWith('/passkeys/register/verify')) {
      state.passkeys = [...state.passkeys, { id: 'pk-9', deviceName: JSON.parse(init.body).deviceName ?? null, createdAt: '2026-10-09T00:00:00.000Z', lastUsedAt: null }];
      return { ok: true, status: 201, json: async () => ({ success: true }) };
    }
    if (method === 'DELETE') { state.passkeys = state.passkeys.filter((p) => !path.endsWith(`/${p.id}`)); return json({ success: true }); }
    return json({});
  };
  return calls;
}

const fakeAuthenticator = (overrides = {}) => ({
  startRegistration: async ({ optionsJSON }) => ({ id: 'cred-1', echoedChallenge: optionsJSON.challenge }),
  startAuthentication: async () => ({ id: 'cred-1' }),
  ...overrides,
});

test('adding a passkey runs the server challenge through the authenticator and lists the new key', async () => {
  const calls = stubApi({ configured: true, passkeys: [] });
  render(React.createElement(PasskeyPanel, { authToken: 't', webauthn: fakeAuthenticator(), supported: true }));
  fireEvent.change(await screen.findByLabelText(/Name this device/), { target: { value: 'Shop laptop' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add a passkey' }));
  const list = await screen.findByRole('list', { name: 'Your passkeys' });
  assert.match(list.textContent, /Shop laptop/);
  const verify = calls.find((c) => c.path.endsWith('/register/verify'));
  const body = JSON.parse(verify.body);
  assert.equal(body.challengeToken, 'tok-1');
  assert.equal(body.response.echoedChallenge, 'abc', 'the authenticator was given the server challenge');
  assert.equal(body.deviceName, 'Shop laptop');
});

test('cancelling the device prompt shows a plain message and saves nothing', async () => {
  const calls = stubApi({ configured: true, passkeys: [] });
  const cancelled = fakeAuthenticator({ startRegistration: async () => { const e = new Error('x'); e.name = 'NotAllowedError'; throw e; } });
  render(React.createElement(PasskeyPanel, { authToken: 't', webauthn: cancelled, supported: true }));
  fireEvent.click(await screen.findByRole('button', { name: 'Add a passkey' }));
  assert.match((await screen.findByRole('alert')).textContent, /cancelled or timed out/);
  assert.equal(calls.some((c) => c.path.endsWith('/register/verify')), false);
});

test('a saved passkey can be removed, and the button is named for the key', async () => {
  const calls = stubApi({ configured: true, passkeys: [{ id: 'pk-1', deviceName: 'Phone', createdAt: '2026-10-01T00:00:00.000Z', lastUsedAt: null }] });
  render(React.createElement(PasskeyPanel, { authToken: 't', webauthn: fakeAuthenticator(), supported: true }));
  fireEvent.click(await screen.findByRole('button', { name: 'Remove passkey Phone' }));
  await waitFor(() => assert.equal(screen.queryByRole('list', { name: 'Your passkeys' }), null));
  assert.ok(calls.some((c) => c.method === 'DELETE' && c.path.endsWith('/passkeys/pk-1')));
});

test('an unconfigured server or an unsupported browser explains itself instead of offering the button', async () => {
  stubApi({ configured: false, passkeys: [] });
  render(React.createElement(PasskeyPanel, { authToken: 't', webauthn: fakeAuthenticator(), supported: true }));
  await screen.findByText(/not enabled on this server/);
  assert.equal(screen.queryByRole('button', { name: 'Add a passkey' }), null);
  cleanup();
  stubApi({ configured: true, passkeys: [] });
  render(React.createElement(PasskeyPanel, { authToken: 't', webauthn: fakeAuthenticator(), supported: false }));
  await screen.findByText(/does not support passkeys/);
  assert.equal(screen.queryByRole('button', { name: 'Add a passkey' }), null);
});

test('the sign-in screen offers a passkey button only where the browser supports it, and it is keyboard reachable', () => {
  const props = { loginEmail: '', setLoginEmail() {}, loginPassword: '', setLoginPassword() {}, loginOtp: '', setLoginOtp() {}, authError: '', authLoading: false };
  let clicked = 0;
  render(React.createElement(LoginCard, { ...props, passkeysAvailable: true, onPasskeySignIn: () => { clicked += 1; } }));
  const button = screen.getByRole('button', { name: 'Sign in with a passkey' });
  button.focus();
  assert.equal(document.activeElement, button);
  fireEvent.click(button);
  assert.equal(clicked, 1);
  cleanup();
  render(React.createElement(LoginCard, { ...props, passkeysAvailable: false, onPasskeySignIn: () => {} }));
  assert.equal(screen.queryByRole('button', { name: 'Sign in with a passkey' }), null);
});
