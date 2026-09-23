import assert from 'node:assert/strict';
import test from 'node:test';
import 'global-jsdom/register';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';
import {
  LoadingState,
  EmptyState,
  ErrorState,
  PermissionDeniedState,
  OfflineState,
} from './feedback-states.jsx';

test.afterEach(() => cleanup());

test('LoadingState announces itself to assistive tech via role=status', () => {
  render(React.createElement(LoadingState, { label: 'Fetching transfers…' }));
  const status = screen.getByRole('status');
  assert.match(status.textContent, /Fetching transfers/);
});

test('EmptyState renders an accessible heading and, when given an action, a keyboard-reachable button', () => {
  const onAction = () => {};
  render(React.createElement(EmptyState, {
    title: 'No transfers yet',
    description: 'Create your first transfer to see it here.',
    action: React.createElement('button', { onClick: onAction }, 'Create transfer'),
  }));
  assert.equal(screen.getByRole('heading', { name: 'No transfers yet' }).tagName, 'H3');
  const button = screen.getByRole('button', { name: 'Create transfer' });
  assert.equal(button.tabIndex, 0, 'a real <button> is keyboard-reachable by default (tabIndex 0)');
});

test('ErrorState retry button is keyboard-activatable and calls onRetry', () => {
  let retried = false;
  render(React.createElement(ErrorState, { description: 'Could not load stock.', onRetry: () => { retried = true; } }));
  const retryButton = screen.getByRole('button', { name: 'Try again' });
  retryButton.focus();
  assert.equal(document.activeElement, retryButton, 'the retry action must be focusable');
  fireEvent.click(retryButton);
  assert.equal(retried, true);
});

test('PermissionDeniedState has an accessible name distinct from EmptyState/ErrorState (screen reader users can tell states apart)', () => {
  render(React.createElement(PermissionDeniedState, { onReturn: () => {} }));
  assert.ok(screen.getByText('Access restricted'));
  assert.ok(screen.getByRole('button', { name: 'Return to dashboard' }));
});

test('OfflineState surfaces a retry action with a distinct, offline-specific label', () => {
  render(React.createElement(OfflineState, { onRetry: () => {} }));
  assert.ok(screen.getByText("You're offline"));
  assert.ok(screen.getByRole('button', { name: 'Retry connection' }));
});

test('all four card-based states expose their message as real text content, not solely via icon/color (contrast-independent labeling)', () => {
  for (const [Component, expectedText] of [
    [EmptyState, 'Nothing here yet'],
    [ErrorState, 'Something went wrong'],
    [PermissionDeniedState, 'Access restricted'],
    [OfflineState, "You're offline"],
  ]) {
    render(React.createElement(Component, {}));
    assert.ok(screen.getByText(expectedText), `${Component.name} must render its state as visible text`);
    cleanup();
  }
});
