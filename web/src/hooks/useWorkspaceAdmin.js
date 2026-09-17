import { apiRequest } from '../lib/api-client';
import { DEFAULT_WORKSPACE_PROFILE } from '../lib/workspace';
import { toggleAssignedLocationIds } from '../lib/workspace-queues';
import { useState } from 'react';

export function useWorkspaceAdmin({
  authToken,
  setLocations,
  setWorkspaceProfile,
  showToast,
}) {
  const [adminPortalOpen, setAdminPortalOpen] = useState(false);
  const [adminTab, setAdminTab] = useState('company');
  const [adminLoading, setAdminLoading] = useState(false);
  const [companyForm, setCompanyForm] = useState({ name: '', email: '', phone: '', industry: 'Grocery', industryKey: 'grocery', address: '' });
  const [industryApplyPending, setIndustryApplyPending] = useState(false);
  const [newLocationForm, setNewLocationForm] = useState({ name: '', type: 'store' });
  const [editingLocationId, setEditingLocationId] = useState(null);
  const [editLocationForm, setEditLocationForm] = useState({ name: '', type: 'store' });
  const [allUsers, setAllUsers] = useState([]);
  const [newUserForm, setNewUserForm] = useState({ name: '', email: '', password: '', role: 'STORE_USER', assignedLocationIds: [] });
  const [editingUserId, setEditingUserId] = useState(null);
  const [editUserForm, setEditUserForm] = useState({ name: '', role: 'STORE_USER', assignedLocationIds: [], password: '' });
  const [permissionUser, setPermissionUser] = useState(null);
  const [permissionCatalog, setPermissionCatalog] = useState({ modules: [], actions: [] });
  const [permissionDraft, setPermissionDraft] = useState({});
  const [permissionScopeId, setPermissionScopeId] = useState('GLOBAL');

  async function openAdminPortal(tab = 'company') {
    setAdminTab(typeof tab === 'string' ? tab : 'company');
    setAdminPortalOpen(true);
    setAdminLoading(true);
    try {
      const headers = { Authorization: `Bearer ${authToken}` };
      const [companyResponse, usersResponse] = await Promise.all([
        apiRequest('/api/v1/company', { headers }),
        apiRequest('/api/v1/users', { headers }),
      ]);
      const company = companyResponse.company ?? {};
      setCompanyForm({
        name: company.name ?? '',
        email: company.email ?? '',
        phone: company.phone ?? '',
        industry: 'Grocery',
        industryKey: 'grocery',
        address: company.address ?? '',
      });
      setAllUsers(usersResponse.users ?? []);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Failed to load admin data.', 'error');
    } finally {
      setAdminLoading(false);
    }
  }

  async function openUserPermissions(user) {
    setAdminLoading(true);
    try {
      const [catalog, current] = await Promise.all([
        apiRequest('/api/v1/permissions/catalog', { headers: { Authorization: `Bearer ${authToken}` } }),
        apiRequest(`/api/v1/users/${user.id}/permissions`, { headers: { Authorization: `Bearer ${authToken}` } }),
      ]);
      const draft = {};
      for (const row of current.permissions ?? []) {
        const key = `${row.scopeId ?? 'GLOBAL'}:${row.permission.module}:${row.permission.action}`;
        draft[key] = row.denied ? 'DENY' : row.allowed ? 'ALLOW' : 'DEFAULT';
      }
      setPermissionUser(user);
      setPermissionCatalog({ modules: catalog.modules ?? [], actions: catalog.actions ?? [] });
      setPermissionDraft(draft);
      setPermissionScopeId('GLOBAL');
      setAdminTab('permissions');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Unable to load permissions.', 'error');
    } finally {
      setAdminLoading(false);
    }
  }

  async function saveUserPermissions() {
    if (!permissionUser) return;
    const permissions = Object.entries(permissionDraft)
      .filter(([, value]) => value !== 'DEFAULT')
      .map(([key, value]) => {
        const [scope, module, action] = key.split(':');
        return {
          module,
          action,
          allowed: value === 'ALLOW',
          denied: value === 'DENY',
          scopeId: scope === 'GLOBAL' ? null : scope,
        };
      });
    setAdminLoading(true);
    try {
      await apiRequest(`/api/v1/users/${permissionUser.id}/permissions`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ permissions }),
      });
      showToast(`Permissions saved for ${permissionUser.name}.`, 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Unable to save permissions.', 'error');
    } finally {
      setAdminLoading(false);
    }
  }

  async function saveCompanyProfile(event) {
    event.preventDefault();
    setAdminLoading(true);
    setIndustryApplyPending(true);
    try {
      const response = await apiRequest('/api/v1/company', {
        method: 'PUT',
        headers: { Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ ...companyForm, industryKey: 'grocery', industry: 'Grocery' }),
      });
      const company = response.company ?? {};
      setCompanyForm({
        name: company.name ?? '',
        email: company.email ?? '',
        phone: company.phone ?? '',
        industry: 'Grocery',
        industryKey: 'grocery',
        address: company.address ?? '',
      });
      const profileResponse = await apiRequest('/api/v1/workspace/profile', { headers: { Authorization: `Bearer ${authToken}` } }).catch(() => null);
      if (profileResponse) {
        setWorkspaceProfile({
          ...DEFAULT_WORKSPACE_PROFILE,
          ...profileResponse,
          pack: { ...DEFAULT_WORKSPACE_PROFILE.pack, ...(profileResponse.pack ?? {}) },
        });
      }
      const applied = response.applied ?? {};
      showToast(applied.createdTags || applied.createdFields
        ? `Company profile saved. Added ${applied.createdTags ?? 0} tags and ${applied.createdFields ?? 0} fields.`
        : 'Company profile saved.', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Failed to save company profile.', 'error');
    } finally {
      setAdminLoading(false);
      setIndustryApplyPending(false);
    }
  }

  async function createLocation(event) {
    event.preventDefault();
    setAdminLoading(true);
    try {
      const response = await apiRequest('/api/v1/locations', {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}` },
        body: JSON.stringify(newLocationForm),
      });
      setLocations((current) => [...current, response.location]);
      setNewLocationForm({ name: '', type: 'store' });
      showToast('Location created.', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Failed to create location.', 'error');
    } finally {
      setAdminLoading(false);
    }
  }

  function startEditLocation(location) {
    setEditingLocationId(location.id);
    setEditLocationForm({ name: location.name, type: location.type });
  }

  async function saveLocationEdit(locationId) {
    setAdminLoading(true);
    try {
      const response = await apiRequest(`/api/v1/locations/${locationId}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${authToken}` },
        body: JSON.stringify(editLocationForm),
      });
      setLocations((current) => current.map((location) => (location.id === locationId ? response.location : location)));
      setEditingLocationId(null);
      showToast('Location updated.', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Failed to update location.', 'error');
    } finally {
      setAdminLoading(false);
    }
  }

  async function deleteLocationById(locationId) {
    setAdminLoading(true);
    try {
      await apiRequest(`/api/v1/locations/${locationId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${authToken}` },
      });
      setLocations((current) => current.filter((location) => location.id !== locationId));
      showToast('Location deleted.', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Failed to delete location.', 'error');
    } finally {
      setAdminLoading(false);
    }
  }

  async function createUser(event) {
    event.preventDefault();
    setAdminLoading(true);
    try {
      const response = await apiRequest('/api/v1/users', {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}` },
        body: JSON.stringify(newUserForm),
      });
      setAllUsers((current) => [...current, response.user]);
      setNewUserForm({ name: '', email: '', password: '', role: 'STORE_USER', assignedLocationIds: [] });
      showToast('User created.', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Failed to create user.', 'error');
    } finally {
      setAdminLoading(false);
    }
  }

  function startEditUser(user) {
    setEditingUserId(user.id);
    setEditUserForm({ name: user.name, role: user.role, assignedLocationIds: user.assignedLocationIds ?? [], password: '' });
  }

  async function saveUserEdit(userId) {
    setAdminLoading(true);
    try {
      const payload = {
        name: editUserForm.name,
        role: editUserForm.role,
        assignedLocationIds: editUserForm.assignedLocationIds,
      };
      if (editUserForm.password) {
        payload.password = editUserForm.password;
      }
      const response = await apiRequest(`/api/v1/users/${userId}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${authToken}` },
        body: JSON.stringify(payload),
      });
      setAllUsers((current) => current.map((user) => (user.id === userId ? response.user : user)));
      setEditingUserId(null);
      showToast('User updated.', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Failed to update user.', 'error');
    } finally {
      setAdminLoading(false);
    }
  }

  async function deleteUserById(userId) {
    setAdminLoading(true);
    try {
      await apiRequest(`/api/v1/users/${userId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${authToken}` },
      });
      setAllUsers((current) => current.filter((user) => user.id !== userId));
      showToast('User deleted.', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Failed to delete user.', 'error');
    } finally {
      setAdminLoading(false);
    }
  }

  function toggleFormLocation(form, setForm, locationId) {
    setForm({
      ...form,
      assignedLocationIds: toggleAssignedLocationIds(form.assignedLocationIds, locationId),
    });
  }

  return {
    adminPortalOpen,
    setAdminPortalOpen,
    adminTab,
    setAdminTab,
    adminLoading,
    companyForm,
    setCompanyForm,
    industryApplyPending,
    newLocationForm,
    setNewLocationForm,
    editingLocationId,
    setEditingLocationId,
    editLocationForm,
    setEditLocationForm,
    allUsers,
    newUserForm,
    setNewUserForm,
    editingUserId,
    setEditingUserId,
    editUserForm,
    setEditUserForm,
    permissionUser,
    permissionCatalog,
    permissionDraft,
    setPermissionDraft,
    permissionScopeId,
    setPermissionScopeId,
    openAdminPortal,
    openUserPermissions,
    saveUserPermissions,
    saveCompanyProfile,
    createLocation,
    startEditLocation,
    saveLocationEdit,
    deleteLocationById,
    createUser,
    startEditUser,
    saveUserEdit,
    deleteUserById,
    toggleFormLocation,
  };
}
