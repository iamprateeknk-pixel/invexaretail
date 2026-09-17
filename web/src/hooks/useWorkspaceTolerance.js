import { apiRequest } from '../lib/api-client';
import { useEffect, useState } from 'react';

// Blueprint Module D / section 10.2 (Count & Audit 2.0) - configurable
// tolerance rules that recommend a recount, never decide one automatically.
export function useWorkspaceTolerance({
  authToken,
  activeSection,
  canManageCounts,
  setSubmitLoading,
  showToast,
}) {
  const [toleranceRules, setToleranceRules] = useState([]);
  const [toleranceRuleForm, setToleranceRuleForm] = useState({ label: '', category: '', valueThreshold: '', percentThreshold: '' });

  useEffect(() => {
    if (!authToken || activeSection !== 'counts' || !canManageCounts) return;
    apiRequest('/api/v1/tolerance-rules', { headers: { Authorization: `Bearer ${authToken}` } })
      .then((response) => setToleranceRules(response.rules ?? []))
      .catch(() => undefined);
  }, [activeSection, authToken, canManageCounts]);

  async function createToleranceRule() {
    if (!toleranceRuleForm.label.trim() || (!toleranceRuleForm.valueThreshold && !toleranceRuleForm.percentThreshold)) return;
    try {
      setSubmitLoading(true);
      const response = await apiRequest('/api/v1/tolerance-rules', {
        method: 'POST', headers: { Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({
          label: toleranceRuleForm.label,
          category: toleranceRuleForm.category || undefined,
          valueThreshold: toleranceRuleForm.valueThreshold || undefined,
          percentThreshold: toleranceRuleForm.percentThreshold || undefined,
        }),
      });
      setToleranceRules((current) => [response.rule, ...current]);
      setToleranceRuleForm({ label: '', category: '', valueThreshold: '', percentThreshold: '' });
      showToast('Tolerance rule created.', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Unable to create tolerance rule.', 'error');
    } finally { setSubmitLoading(false); }
  }

  async function toggleToleranceRule(ruleId, active) {
    try {
      const response = await apiRequest(`/api/v1/tolerance-rules/${ruleId}`, {
        method: 'PATCH', headers: { Authorization: `Bearer ${authToken}` }, body: JSON.stringify({ active }),
      });
      setToleranceRules((current) => current.map((rule) => rule.id === ruleId ? response.rule : rule));
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Unable to update tolerance rule.', 'error');
    }
  }

  return { toleranceRules, toleranceRuleForm, setToleranceRuleForm, createToleranceRule, toggleToleranceRule };
}
