import { apiRequest } from '../lib/api-client';
import { useEffect, useState } from 'react';

export function useWorkspaceSaas({
  authToken,
  role,
  activeSection,
  setSubmitLoading,
  setModuleWarning,
  showToast,
}) {
  const [saasPlans, setSaasPlans] = useState([]);
  const [saasTenants, setSaasTenants] = useState([]);
  const [saasForm, setSaasForm] = useState({
    companyName: '', adminName: '', adminEmail: '', planCode: 'starter', password: 'ChangeMe123!',
  });

  function loadSaas() {
    if (!authToken) return;
    const headers = { Authorization: `Bearer ${authToken}` };
    apiRequest('/api/v1/saas/plans', { headers })
      .then((response) => setSaasPlans(response.plans ?? []))
      .catch(() => undefined);
    if (role === 'ADMIN') {
      apiRequest('/api/v1/saas/tenants', { headers })
        .then((response) => setSaasTenants(response.tenants ?? []))
        .catch((error) => setModuleWarning(error instanceof Error ? error.message : 'Unable to load tenants.'));
    }
  }

  useEffect(() => {
    if (!authToken || activeSection !== 'saas') return;
    loadSaas();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSection, authToken, role]);

  async function onboardTenant() {
    try {
      setSubmitLoading(true);
      const response = await apiRequest('/api/v1/saas/onboard', {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}` },
        body: JSON.stringify(saasForm),
      });
      setSaasTenants((current) => [response.tenant, ...current]);
      setSaasForm({ companyName: '', adminName: '', adminEmail: '', planCode: 'starter', password: 'ChangeMe123!' });
      showToast(`Tenant ${response.tenant.name} provisioned on ${response.tenant.planCode}.`, 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Unable to provision tenant.', 'error');
    } finally {
      setSubmitLoading(false);
    }
  }

  return { saasPlans, saasTenants, saasForm, setSaasForm, onboardTenant, refreshSaas: loadSaas };
}
