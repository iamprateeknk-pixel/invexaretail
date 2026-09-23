// Week 9: the DOM-level regression test for the permission/route-guard
// unification (lib/permissions.js). A role-restricted section renders
// PermissionDeniedState instead of its page - this is the exact bug class
// the old, separately-maintained SECTION_ROLES table left open for most
// sections (see lib/permissions.js's header comment and
// lib/permissions.test.js for the full role x section matrix proof; this
// file proves the same thing actually reaches the rendered DOM).
import assert from 'node:assert/strict';
import test from 'node:test';
import 'global-jsdom/register';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';
import { Workspace } from './Workspace.jsx';
import { WorkspaceProvider } from './WorkspaceContext.jsx';

test.afterEach(() => cleanup());

function renderWorkspace(overrides) {
  const value = {
    activeSection: 'dashboard',
    role: 'STORE_USER',
    navigateTo: () => {},
    showToast: () => {},
    hiddenModules: new Set(),
    ...overrides,
  };
  render(React.createElement(WorkspaceProvider, { value }, React.createElement(Workspace)));
}

test('a Store User is denied "putaway" - role-restricted in NAVIGATION but never covered by the old SECTION_ROLES route guard', () => {
  renderWorkspace({ activeSection: 'putaway', role: 'STORE_USER' });
  assert.ok(screen.getByText('Access restricted'));
  assert.ok(screen.getByRole('button', { name: 'Return to dashboard' }));
});

// The "role IS allowed" side is intentionally not exercised by rendering a
// real page here: every SECTION_PAGES entry expects the full workspace
// data context (items, locations, live-sync state, etc.), which would turn
// this into a mock of the entire app rather than a permission-gate test.
// lib/permissions.test.js's full role x section matrix already proves the
// allow side of canAccessSection exhaustively and without that overhead;
// this file's job is only to prove the denial actually reaches rendered
// DOM, which the test above does.

test('a section hidden by the industry pack/entitlements is denied at the route level even for ADMIN', () => {
  renderWorkspace({ activeSection: 'orders', role: 'ADMIN', hiddenModules: new Set(['orders']) });
  assert.ok(screen.getByText('Access restricted'));
});

test('the "Return to dashboard" action is keyboard-focusable', () => {
  renderWorkspace({ activeSection: 'saas', role: 'STORE_USER' });
  const button = screen.getByRole('button', { name: 'Return to dashboard' });
  button.focus();
  assert.equal(document.activeElement, button);
});
