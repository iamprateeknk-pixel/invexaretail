import assert from 'node:assert/strict';
import test from 'node:test';
import 'global-jsdom/register';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { MobilePolicyEditor, RulesEditor } from './StudioEditors.jsx';
import { ModeSwitch, StudioModeProvider } from './studio-mode.jsx';

test.afterEach(() => cleanup());

const draft = {
  rules: [{ key: 'high_value_adjustment', name: 'High value adjustment approval', condition: { branchCity: 'Jaipur', adjustmentValueGt: 10000 }, outcome: { requireApproval: 'BRANCH_MANAGER' } }],
  mobilePolicies: [{ role: 'STORE_USER', offlineMaxHours: 12, syncScope: ['stock', 'counts'], navigation: ['dashboard', 'stock', 'counts'], encryptedLocalStore: true }],
};

function mount(element) {
  return render(React.createElement(StudioModeProvider, { initialAdvanced: false }, React.createElement(ModeSwitch), element));
}

function stubFetch(calls) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), method: init.method, body: init.body ? JSON.parse(init.body) : undefined });
    return new Response('{"success":true}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  return () => { globalThis.fetch = original; };
}

test('Simple mode reads in plain words and hides technical keys; Advanced shows them', () => {
  mount(React.createElement(RulesEditor, { controlToken: 't', draft }));
  assert.ok(screen.getByText(/When Branch city is Jaipur and Stock adjustment value \(₹\) is more than 10000 → Ask a branch manager to approve/));
  assert.equal(screen.queryByLabelText('Technical key'), null);
  fireEvent.click(screen.getByRole('button', { name: 'Advanced' }));
  assert.equal(screen.getByRole('button', { name: 'Advanced' }).getAttribute('aria-pressed'), 'true');
  assert.equal(screen.getByLabelText('Technical key').value, 'high_value_adjustment');
});

test('editing a rule and saving sends only that rule, as an upsert', async () => {
  const calls = [];
  const restore = stubFetch(calls);
  try {
    let saved = 0;
    mount(React.createElement(RulesEditor, { controlToken: 't', draft, onSaved: () => { saved += 1; } }));
    assert.equal(screen.getByRole('button', { name: 'Save changes' }).disabled, true, 'nothing to save before an edit');
    fireEvent.change(screen.getByLabelText('Rule name'), { target: { value: 'Big adjustment' } });
    assert.ok(screen.getByText('Unsaved changes'));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save changes' })); });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, 'POST');
    assert.match(calls[0].url, /\/studio\/v1\/rules$/);
    assert.equal(calls[0].body.key, 'high_value_adjustment');
    assert.equal(calls[0].body.name, 'Big adjustment');
    assert.deepEqual(calls[0].body.outcome, { requireApproval: 'BRANCH_MANAGER' });
    assert.equal(saved, 1);
  } finally {
    restore();
  }
});

test('removing a role policy sends a delete for that role', async () => {
  const calls = [];
  const restore = stubFetch(calls);
  try {
    mount(React.createElement(MobilePolicyEditor, { controlToken: 't', draft }));
    assert.ok(screen.getByText(/Store user: Home, Stock, Stock counts · offline up to 12 h/));
    fireEvent.click(screen.getByRole('button', { name: /^Remove/ }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save changes' })); });
    assert.deepEqual(calls.map((call) => [call.method, call.url.replace(/^.*\/studio/, '/studio')]), [['DELETE', '/studio/v1/mobile-policy/STORE_USER']]);
  } finally {
    restore();
  }
});
