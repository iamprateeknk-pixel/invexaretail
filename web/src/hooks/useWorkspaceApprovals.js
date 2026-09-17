import { apiRequest } from '../lib/api-client';
import { useEffect, useState } from 'react';

// Blueprint section 16.2 (Workflow Builder) - configurable, action-gating
// approval rules (distinct from tolerance rules, which only recommend).
export function useWorkspaceApprovals({
  authToken,
  activeSection,
  canManageCounts,
  setSubmitLoading,
  showToast,
}) {
  const [approvalRequests, setApprovalRequests] = useState([]);
  const [approvalRules, setApprovalRules] = useState([]);
  const [approvalRuleForm, setApprovalRuleForm] = useState({ label: '', triggerType: 'TRANSFER_CONFIRM', category: '', valueThreshold: '', requiredApproverRole: 'BRANCH_MANAGER' });

  function loadApprovalRequests() {
    if (!authToken) return;
    apiRequest('/api/v1/approval-requests?status=PENDING', { headers: { Authorization: `Bearer ${authToken}` } })
      .then((response) => setApprovalRequests(response.requests ?? []))
      .catch(() => undefined);
  }

  useEffect(() => {
    if (!authToken || activeSection !== 'approvals' || !canManageCounts) return;
    loadApprovalRequests();
    apiRequest('/api/v1/approval-rules', { headers: { Authorization: `Bearer ${authToken}` } })
      .then((response) => setApprovalRules(response.rules ?? []))
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSection, authToken, canManageCounts]);

  async function decideApprovalRequest(requestId, decision) {
    try {
      setSubmitLoading(true);
      await apiRequest(`/api/v1/approval-requests/${requestId}/decide`, {
        method: 'POST', headers: { Authorization: `Bearer ${authToken}` }, body: JSON.stringify({ decision }),
      });
      setApprovalRequests((current) => current.filter((request) => request.id !== requestId));
      showToast(`Request ${decision === 'APPROVED' ? 'approved' : 'rejected'}.`, 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Unable to decide approval request.', 'error');
    } finally { setSubmitLoading(false); }
  }

  async function createApprovalRule() {
    if (!approvalRuleForm.label.trim() || !approvalRuleForm.valueThreshold) return;
    try {
      setSubmitLoading(true);
      const response = await apiRequest('/api/v1/approval-rules', {
        method: 'POST', headers: { Authorization: `Bearer ${authToken}` },
        body: JSON.stringify(approvalRuleForm),
      });
      setApprovalRules((current) => [response.rule, ...current]);
      setApprovalRuleForm({ label: '', triggerType: 'TRANSFER_CONFIRM', category: '', valueThreshold: '', requiredApproverRole: 'BRANCH_MANAGER' });
      showToast('Approval rule created.', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Unable to create approval rule.', 'error');
    } finally { setSubmitLoading(false); }
  }

  async function toggleApprovalRule(ruleId, active) {
    try {
      const response = await apiRequest(`/api/v1/approval-rules/${ruleId}`, {
        method: 'PATCH', headers: { Authorization: `Bearer ${authToken}` }, body: JSON.stringify({ active }),
      });
      setApprovalRules((current) => current.map((rule) => rule.id === ruleId ? response.rule : rule));
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Unable to update approval rule.', 'error');
    }
  }

  return {
    approvalRequests, approvalRules, approvalRuleForm, setApprovalRuleForm,
    decideApprovalRequest, createApprovalRule, toggleApprovalRule,
  };
}
