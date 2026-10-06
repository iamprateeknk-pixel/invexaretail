import assert from 'node:assert/strict';
import test from 'node:test';
import 'global-jsdom/register';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import React from 'react';
import { TwoFactorPanel } from './TwoFactorPanel.jsx';

test.afterEach(() => { cleanup(); delete globalThis.fetch; });

function stubApi(state) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const path = String(url).replace(/^https?:\/\/[^/]+/, '');
    calls.push({ path, method: init.method ?? 'GET', body: init.body });
    const json = (body) => ({ ok: true, status: 200, json: async () => body });
    if (path.endsWith('/2fa/status')) return json(state.status);
    if (path.endsWith('/2fa/setup')) return json({ secret: 'JBSWY3DPEHPK3PXP', otpauthUri: 'otpauth://totp/x?secret=JBSWY3DPEHPK3PXP' });
    if (path.endsWith('/2fa/enable')) { state.status = { configured: true, enabled: true, pendingSetup: false, backupCodesRemaining: 2 }; return json({ backupCodes: ['AAAAA-BBBBB', 'CCCCC-DDDDD'] }); }
    return json({});
  };
  return calls;
}

test('enrolment walks through setup key, code entry and one-time backup codes', async () => {
  const calls = stubApi({ status: { configured: true, enabled: false, pendingSetup: false, backupCodesRemaining: 0 } });
  render(React.createElement(TwoFactorPanel, { authToken: 't' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Set up two-factor' }));
  assert.equal((await screen.findByLabelText('Setup key')).textContent, 'JBSWY3DPEHPK3PXP');
  const qr = await screen.findByAltText(/QR code/);
  assert.match(qr.getAttribute('src'), /^data:image\/svg\+xml/, 'the setup link is also offered as a scannable QR code');
  const turnOn = screen.getByRole('button', { name: 'Turn on' });
  assert.equal(turnOn.disabled, true, 'needs a full 6-digit code first');
  fireEvent.change(screen.getByLabelText(/6-digit code/), { target: { value: '123456' } });
  fireEvent.click(screen.getByRole('button', { name: 'Turn on' }));
  const list = await screen.findByRole('list', { name: 'Backup codes' });
  assert.match(list.textContent, /AAAAA-BBBBB/);
  const enable = calls.find((c) => c.path.endsWith('/2fa/enable'));
  assert.deepEqual(JSON.parse(enable.body), { code: '123456' });
  await waitFor(() => assert.ok(screen.getByText('On')));
});

test('a server without the encryption key explains it instead of offering setup', async () => {
  stubApi({ status: { configured: false, enabled: false, pendingSetup: false, backupCodesRemaining: 0 } });
  render(React.createElement(TwoFactorPanel, { authToken: 't' }));
  await screen.findByText(/not enabled on this server/);
  assert.equal(screen.queryByRole('button', { name: 'Set up two-factor' }), null);
});

test('when on, turning it off is gated on a plausible code', async () => {
  stubApi({ status: { configured: true, enabled: true, pendingSetup: false, backupCodesRemaining: 8 } });
  render(React.createElement(TwoFactorPanel, { authToken: 't' }));
  const off = await screen.findByRole('button', { name: 'Turn off two-factor' });
  assert.equal(off.disabled, true);
  fireEvent.change(screen.getByLabelText(/turn it off/), { target: { value: '123456' } });
  assert.equal(screen.getByRole('button', { name: 'Turn off two-factor' }).disabled, false);
});
