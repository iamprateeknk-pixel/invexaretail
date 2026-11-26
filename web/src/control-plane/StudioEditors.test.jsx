import assert from 'node:assert/strict';
import test from 'node:test';
import 'global-jsdom/register';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { AutomationsEditor, MobilePolicyEditor, RulesEditor, WorkflowsEditor } from './StudioEditors.jsx';
import { modelToWorkflow } from './studio-catalog.js';
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

test('a rule stays in simulation until explicitly assigned to a live command', async () => {
  const calls = [];
  const restore = stubFetch(calls);
  const rule = { ...draft.rules[0], condition: { adjustmentValueGt: 10000 } };
  try {
    mount(React.createElement(RulesEditor, { controlToken: 't', draft: { rules: [rule] } }));
    const target = screen.getByRole('combobox', { name: 'Apply rule to' });
    assert.equal(target.value, 'simulation');
    fireEvent.change(target, { target: { value: 'STOCK_ADJUSTMENT' } });
    assert.ok(screen.getByText(/Use stock adjustment value for each condition/));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save changes' })); });
    assert.deepEqual(calls.map(({ body }) => body), [{ ...rule, liveFor: 'STOCK_ADJUSTMENT' }]);
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

test('a workflow stays in simulation until explicitly enabled', async () => {
  const calls = [];
  const restore = stubFetch(calls);
  try {
    const workflow = modelToWorkflow({ key: 'dispatch', name: 'Dispatch', target: 'transfer', threshold: '500', approverRole: 'ADMIN' });
    mount(React.createElement(WorkflowsEditor, { controlToken: 't', draft: { workflows: [workflow] } }));
    const toggle = screen.getByRole('checkbox', { name: 'Enforce on live commands after publishing' });
    toggle.focus();
    assert.equal(document.activeElement, toggle);
    assert.equal(toggle.getAttribute('aria-checked'), 'false');
    fireEvent.click(toggle);
    assert.equal(toggle.getAttribute('aria-checked'), 'true');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save changes' })); });
    assert.deepEqual(calls.map((call) => call.body?.enforce), [true]);
  } finally { restore(); }
});

test('count approval uses a variance value threshold and can be enabled for live review', async () => {
  const calls = [];
  const restore = stubFetch(calls);
  try {
    const workflow = modelToWorkflow({ key: 'count.approval', name: 'Count variance', target: 'count', threshold: '100', approverRole: 'ADMIN' });
    mount(React.createElement(WorkflowsEditor, { controlToken: 't', draft: { workflows: [workflow] } }));
    assert.equal(screen.getByLabelText('Variance value threshold (₹)').value, '100');
    const toggle = screen.getByRole('checkbox', { name: 'Enforce on live commands after publishing' });
    fireEvent.click(toggle);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save changes' })); });
    assert.equal(calls[0].body.enforce, true);
    assert.equal(calls[0].body.graph.nodes[0].config.event, 'count.created');
  } finally { restore(); }
});

test('scheduled reminders require explicit activation and failed runs show their reason', async () => {
  const previous = globalThis.fetch;
  const saved = [];
  globalThis.fetch = async (url, init) => {
    assert.match(url, /\/studio\/v1\/automations/);
    if (init.method === 'GET') return Response.json({ runs: [{
      id: 'run-1', name: 'Daily reminder', occurrence: '2027-02-01', configVersion: 2, status: 'DEAD_LETTER', attempts: 5, failureCode: 'NO_ACTIVE_ADMINS',
    }] });
    saved.push(JSON.parse(init.body));
    return Response.json({ success: true });
  };
  try {
    const automation = { key: 'reminder', name: 'Daily reminder', trigger: 'schedule', expression: 'daily@09:00', actionKey: 'SEND_NOTIFICATION' };
    mount(React.createElement(AutomationsEditor, { controlToken: 't', draft: { automations: [automation] } }));
    await screen.findByText('Failed after retries');
    assert.ok(screen.getByText('No active company admins'));
    const checkbox = screen.getByRole('checkbox', { name: 'Send after publishing, using the company timezone' });
    assert.equal(checkbox.getAttribute('aria-checked'), 'false');
    fireEvent.click(checkbox);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save changes' })); });
    assert.deepEqual(saved, [{ ...automation, enforce: true }]);
  } finally { globalThis.fetch = previous; }
});

test('an event notification can be enabled only for a supported business event', async () => {
  const original = globalThis.fetch;
  const saved = [];
  globalThis.fetch = async (_url, init) => {
    if (init.method === 'GET') return Response.json({ runs: [] });
    saved.push(JSON.parse(init.body));
    return Response.json({ success: true });
  };
  try {
    const automation = { key: 'count', name: 'Count submitted', trigger: 'event', expression: 'count.submitted', actionKey: 'SEND_NOTIFICATION' };
    mount(React.createElement(AutomationsEditor, { controlToken: 't', draft: { automations: [automation] } }));
    const toggle = screen.getByRole('checkbox', { name: 'Send for new events after publishing' });
    fireEvent.click(toggle);
    const event = screen.getByRole('combobox', { name: 'What happens' });
    fireEvent.change(event, { target: { value: 'inventory.low_stock' } });
    assert.ok(!screen.queryByRole('checkbox', { name: 'Send for new events after publishing' }));
    fireEvent.change(event, { target: { value: 'transfer.created' } });
    assert.equal(screen.getByRole('checkbox', { name: 'Send for new events after publishing' }).getAttribute('aria-checked'), 'false');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Send for new events after publishing' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save changes' })); });
    assert.deepEqual(saved, [{ ...automation, expression: 'transfer.created', enforce: true }]);
  } finally { globalThis.fetch = original; }
});

test('a failed run can be retried using the failure shown in Studio', async () => {
  const original = globalThis.fetch;
  const requests = [];
  const failure = { id: 'run-1', name: 'Count submitted', occurrence: 'count.submitted:count-1', configVersion: 2,
    status: 'DEAD_LETTER', attempts: 5, finishedAt: '2027-02-01T10:30:00.000Z', failureCode: 'NO_ACTIVE_ADMINS' };
  globalThis.fetch = async (url, init) => {
    if (init.method === 'GET') return Response.json({ runs: [requests.length ? { ...failure, status: 'PENDING', attempts: 0, failureCode: null } : failure] });
    requests.push({ url, body: JSON.parse(init.body) });
    return Response.json({ success: true });
  };
  try {
    mount(React.createElement(AutomationsEditor, { controlToken: 't', draft: { automations: [] } }));
    const retry = await screen.findByRole('button', { name: 'Retry Count submitted' });
    retry.focus();
    assert.equal(document.activeElement, retry);
    fireEvent.click(retry);
    await screen.findByText('Retry queued.');
    assert.match(requests[0].url, /\/automations\/runs\/run-1\/retry$/);
    assert.deepEqual(requests[0].body, { finishedAt: failure.finishedAt });
  } finally { globalThis.fetch = original; }
});
