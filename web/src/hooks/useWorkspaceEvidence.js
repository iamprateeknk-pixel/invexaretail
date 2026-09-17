import { apiRequest } from '../lib/api-client';
import { useEffect, useState } from 'react';

// Blueprint section 16.2, third named workflow example: "damaged receipt >
// threshold -> photo mandatory." Distinct from tolerance rules (recommend)
// and approval rules (gate on a human decision): this gates on a fact that
// must already exist - evidence already uploaded for the transfer.
export function useWorkspaceEvidence({
  authToken,
  activeSection,
  canManageCounts,
  setSubmitLoading,
  showToast,
}) {
  const [evidenceRules, setEvidenceRules] = useState([]);
  const [evidenceRuleForm, setEvidenceRuleForm] = useState({ label: '', triggerType: 'TRANSFER_RECEIVE_DAMAGE', category: '', quantityThreshold: '', valueThreshold: '' });

  useEffect(() => {
    if (!authToken || activeSection !== 'approvals' || !canManageCounts) return;
    apiRequest('/api/v1/evidence-rules', { headers: { Authorization: `Bearer ${authToken}` } })
      .then((response) => setEvidenceRules(response.rules ?? []))
      .catch(() => undefined);
  }, [activeSection, authToken, canManageCounts]);

  async function createEvidenceRule() {
    if (!evidenceRuleForm.label.trim() || (!evidenceRuleForm.quantityThreshold && !evidenceRuleForm.valueThreshold)) return;
    try {
      setSubmitLoading(true);
      const response = await apiRequest('/api/v1/evidence-rules', {
        method: 'POST', headers: { Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({
          label: evidenceRuleForm.label,
          triggerType: evidenceRuleForm.triggerType,
          category: evidenceRuleForm.category || undefined,
          quantityThreshold: evidenceRuleForm.quantityThreshold || undefined,
          valueThreshold: evidenceRuleForm.valueThreshold || undefined,
        }),
      });
      setEvidenceRules((current) => [response.rule, ...current]);
      setEvidenceRuleForm({ label: '', triggerType: 'TRANSFER_RECEIVE_DAMAGE', category: '', quantityThreshold: '', valueThreshold: '' });
      showToast('Evidence rule created.', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Unable to create evidence rule.', 'error');
    } finally { setSubmitLoading(false); }
  }

  async function toggleEvidenceRule(ruleId, active) {
    try {
      const response = await apiRequest(`/api/v1/evidence-rules/${ruleId}`, {
        method: 'PATCH', headers: { Authorization: `Bearer ${authToken}` }, body: JSON.stringify({ active }),
      });
      setEvidenceRules((current) => current.map((rule) => rule.id === ruleId ? response.rule : rule));
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Unable to update evidence rule.', 'error');
    }
  }

  return { evidenceRules, evidenceRuleForm, setEvidenceRuleForm, createEvidenceRule, toggleEvidenceRule };
}
