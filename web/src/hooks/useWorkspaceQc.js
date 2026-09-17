import { apiRequest } from '../lib/api-client';
import { useEffect, useState } from 'react';

export function useWorkspaceQc({
  authToken,
  activeSection,
  setSubmitLoading,
  setModuleWarning,
  showToast,
}) {
  const [qcTemplates, setQcTemplates] = useState([]);
  const [qcInspections, setQcInspections] = useState([]);
  const [qcForm, setQcForm] = useState({ label: '', category: '' });

  function loadQc() {
    if (!authToken) return;
    const headers = { Authorization: `Bearer ${authToken}` };
    Promise.all([
      apiRequest('/api/v1/qc-templates', { headers }),
      apiRequest('/api/v1/qc-inspections', { headers }),
    ]).then(([templatesResponse, inspectionsResponse]) => {
      setQcTemplates(templatesResponse.templates ?? []);
      setQcInspections(inspectionsResponse.inspections ?? []);
    }).catch((error) => setModuleWarning(error instanceof Error ? error.message : 'Unable to load QC checklists.'));
  }

  useEffect(() => {
    if (!authToken || !['qc', 'transfers', 'picking'].includes(activeSection)) return;
    loadQc();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSection, authToken]);

  async function createQcTemplate() {
    if (!qcForm.label.trim()) return;
    try {
      setSubmitLoading(true);
      const response = await apiRequest('/api/v1/qc-templates', {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ label: qcForm.label.trim(), category: qcForm.category.trim() || null }),
      });
      setQcTemplates((current) => [response.template, ...current]);
      setQcForm({ label: '', category: '' });
      showToast('QC checklist template published. Matching receipts now require an inspection.', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Unable to create QC template.', 'error');
    } finally {
      setSubmitLoading(false);
    }
  }

  async function setQcTemplateActive(templateId, active) {
    try {
      setSubmitLoading(true);
      const response = await apiRequest(`/api/v1/qc-templates/${templateId}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ active }),
      });
      setQcTemplates((current) => current.map((row) => row.id === templateId ? response.template : row));
      showToast(active ? 'Template is required on matching receipts.' : 'Template deactivated.', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Unable to update QC template.', 'error');
    } finally {
      setSubmitLoading(false);
    }
  }

  return { qcTemplates, qcInspections, qcForm, setQcForm, createQcTemplate, setQcTemplateActive, refreshQc: loadQc };
}
