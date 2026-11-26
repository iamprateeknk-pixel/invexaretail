import assert from 'node:assert/strict';
import test from 'node:test';
import { publishedWorkflowApprovals, workflowApprovalPolicy } from './workflow-approval-policy.js';

const workflow = {
  key: 'transfer.approval', name: 'Dispatch approval', graph: { nodes: [
    { type: 'trigger', config: { event: 'transfer.created' } },
    { type: 'condition', config: { field: 'value', op: 'lte', amount: 100 } },
    { type: 'approval', config: { role: 'BRANCH_MANAGER' } },
  ] },
};

test('only explicitly enabled workflows apply to a supported live command', () => {
  assert.equal(workflowApprovalPolicy(workflow), null);
  const enabled = { ...workflow, enforce: true };
  assert.deepEqual(publishedWorkflowApprovals({ workflows: [workflow, enabled] }, 'TRANSFER_CONFIRM'), [{
    workflowKey: 'transfer.approval', label: 'Dispatch approval', triggerType: 'TRANSFER_CONFIRM',
    threshold: 100, requiredApproverRole: 'BRANCH_MANAGER',
  }]);
  assert.deepEqual(publishedWorkflowApprovals({ workflows: [enabled] }, 'PO_APPROVE'), []);
  const count = { ...enabled, graph: { nodes: [{ type: 'trigger', config: { event: 'count.created' } }, ...workflow.graph.nodes.slice(1)] } };
  assert.throws(() => workflowApprovalPolicy(count), /supported operation/);
});
