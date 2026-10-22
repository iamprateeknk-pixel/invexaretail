import assert from 'node:assert/strict';
import test from 'node:test';
import 'global-jsdom/register';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { ControlPlaneApp } from './ControlPlaneApp.jsx';
import { clearControlSession, writeControlSession } from './control-api.js';

test.afterEach(() => {
  cleanup();
  clearControlSession();
});

// The control-plane API is answered locally; every payload is the emptiest
// shape the workspace tolerates, so the shell must render its chrome (login,
// company picker, section nav) without any live data behind it.
function stubFetchOk() {
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const path = String(url);
    const payload = path.includes('/studio/v1/draft') ? { draft: null }
      : path.includes('/control/v1/users') ? { users: [] }
      : path.includes('/studio/v1/runtime') ? { runtime: null }
      : path.includes('/control/v1/companies') ? { companies: [company] }
      : path.includes('/control/v1/health') ? { ok: true, companies: 1, killSwitches: {} }
      : path.includes('/control/v1/audit') ? { events: [] }
      : {};
    return new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  return () => { globalThis.fetch = original; };
}

const company = { id: 'company-1', name: 'Acme Retail', planId: 'pro', status: 'active', entitlements: {} };

test('signed-out shell shows the login form with an empty email field', () => {
  render(React.createElement(ControlPlaneApp));
  assert.equal(screen.getByLabelText('Email').value, '');
  assert.ok(screen.getByRole('button', { name: 'Sign in' }));
});

test('platform session shows the company picker', async () => {
  const restore = stubFetchOk();
  try {
    writeControlSession({
      platformToken: 'platform-token',
      user: { id: 'user-1', name: 'Root Admin' },
      companies: [company],
    });
    render(React.createElement(ControlPlaneApp));
    assert.ok(await screen.findByText('Select one company'));
    assert.ok(screen.getByRole('button', { name: 'Lock session' }));
  } finally {
    restore();
  }
});

test('locked session renders the workspace nav and switches sections', async () => {
  const restore = stubFetchOk();
  try {
    writeControlSession({
      platformToken: 'platform-token',
      controlToken: 'control-token',
      user: { id: 'user-1', name: 'Root Admin' },
      company,
      companies: [company],
    });
    render(React.createElement(ControlPlaneApp));
    for (const label of ['Company', 'Studio', 'Users', 'Approvals', 'Mobile & sync', 'Integrations', 'Billing', 'Health']) {
      assert.ok(screen.getByRole('button', { name: label }), label);
    }
    fireEvent.click(screen.getByRole('button', { name: 'Billing' }));
    assert.ok(await screen.findByText('Usage vs limits'));
  } finally {
    restore();
  }
});
