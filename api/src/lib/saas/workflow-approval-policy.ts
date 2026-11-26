const WORKFLOW_EVENTS = {
  'transfer.created': 'TRANSFER_CONFIRM',
  'adjustment.created': 'STOCK_ADJUSTMENT',
  'purchase_order.created': 'PO_APPROVE',
} as const;

const REVIEWER_ROLES = ['BRANCH_MANAGER', 'ADMIN_USER', 'ADMIN'] as const;

export type StudioApprovalPolicy = {
  workflowKey: string;
  label: string;
  triggerType: string;
  threshold: number;
  requiredApproverRole: typeof REVIEWER_ROLES[number];
};

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function workflowApprovalPolicy(input: unknown): StudioApprovalPolicy | null {
  const workflow = object(input);
  if (workflow.enforce !== true) return null;
  const nodes = object(workflow.graph).nodes;
  if (!Array.isArray(nodes)) throw new Error('A live approval workflow needs a trigger, threshold and reviewer.');
  const config = (type: string) => object(object(nodes.find((node) => object(node).type === type)).config);
  const event = config('trigger').event;
  const condition = config('condition');
  const threshold = condition.amount;
  const role = config('approval').role;
  if (typeof event !== 'string' || !Object.hasOwn(WORKFLOW_EVENTS, event) ||
      condition.field !== 'value' || condition.op !== 'lte' || typeof threshold !== 'number' ||
      !Number.isFinite(threshold) || threshold < 0 || threshold >= 1e12 ||
      !REVIEWER_ROLES.some((candidate) => candidate === role) ||
      typeof workflow.key !== 'string' || !workflow.key.trim() || typeof workflow.name !== 'string' || !workflow.name.trim()) {
    throw new Error('A live approval requires a supported operation, a nonnegative amount and a qualified reviewer.');
  }
  return {
    workflowKey: workflow.key, label: workflow.name, triggerType: WORKFLOW_EVENTS[event as keyof typeof WORKFLOW_EVENTS],
    threshold, requiredApproverRole: role as StudioApprovalPolicy['requiredApproverRole'],
  };
}

export function usesStudioApproval(triggerType: string): boolean {
  return Object.values(WORKFLOW_EVENTS).some((value) => value === triggerType);
}

export function publishedWorkflowApprovals(payload: unknown, triggerType: string): StudioApprovalPolicy[] {
  const workflows = object(payload).workflows;
  if (!Array.isArray(workflows)) return [];
  return workflows.map(workflowApprovalPolicy).filter((policy): policy is StudioApprovalPolicy => policy?.triggerType === triggerType);
}

export function storedWorkflowApproval(policy: unknown) {
  const { workflowKey, label, requiredApproverRole, configVersion, locationId } = object(policy);
  if (typeof workflowKey !== 'string' || typeof label !== 'string' || typeof configVersion !== 'number' ||
      !REVIEWER_ROLES.some((role) => role === requiredApproverRole)) return null;
  return { workflowKey, label, configVersion, locationId: typeof locationId === 'string' ? locationId : null,
    requiredApproverRole: requiredApproverRole as StudioApprovalPolicy['requiredApproverRole'] };
}
