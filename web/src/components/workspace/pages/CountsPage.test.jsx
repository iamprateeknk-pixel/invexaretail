import assert from 'node:assert/strict';
import test from 'node:test';
import 'global-jsdom/register';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { CountsPage } from './CountsPage.jsx';
import { WorkspaceProvider } from '../WorkspaceContext.jsx';

test('requesters wait for another reviewer while independent reviewers can act', () => {
  const decisions = [];
  const workspace = {
    activeSection: 'approvals', canManageCounts: true, role: 'ADMIN', countTaskRows: [],
    approvalRequests: [{ id: 'request-1', entityType: 'Transfer', entityId: 'transfer-1', valueAtStake: 2000, requestedBy: { id: 'requester', name: 'Requester' } }],
    approvalRules: [], approvalRuleForm: { label: '' }, evidenceRules: [], evidenceRuleForm: { label: '' },
    decideApprovalRequest: (...args) => decisions.push(args),
  };
  const page = (userId) => (
    <WorkspaceProvider value={{ ...workspace, session: { user: { id: userId } } }}>
      <CountsPage />
    </WorkspaceProvider>
  );
  try {
    const view = render(page('requester'));
    assert.ok(screen.getByText('Waiting for another reviewer'));
    assert.equal(screen.queryByRole('button', { name: 'Approve' }), null);
    assert.equal(screen.queryByRole('button', { name: 'Reject' }), null);

    view.rerender(page('reviewer'));
    assert.equal(screen.queryByText('Waiting for another reviewer'), null);
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    assert.deepEqual(decisions, [['request-1', 'APPROVED']]);
  } finally {
    cleanup();
  }
});
