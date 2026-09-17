import { persistEnterpriseUser, persistLocationCreate } from '../persistence.js';
import { createEnhancedUser, findUserByEmail } from '../enterprise-repository.js';
import { locations, users, type LocationRecord } from '../repository.js';
import { ControlPlaneError } from './control-plane.js';
import { registerLocationCompany } from './tenant-scope.js';

export async function provisionOperationalTenant(input: {
  companyId: string;
  companyName: string;
  admin: { id: string; email: string; name: string; passwordHash: string };
}): Promise<{ location: LocationRecord }> {
  if (findUserByEmail(input.admin.email)) {
    throw new ControlPlaneError('Email already in use', 'EMAIL_IN_USE', 409);
  }
  const location: LocationRecord = {
    id: `loc-${input.companyId}-main`,
    name: `${input.companyName} Store`,
    type: 'store',
  };
  const code = `STORE-${input.companyId.slice(-6).toUpperCase()}`;
  await persistLocationCreate(location, code, input.companyId);
  registerLocationCompany(location.id, input.companyId);
  if (!locations.some((row) => row.id === location.id)) {
    locations.push(location);
  }
  createEnhancedUser({
    id: input.admin.id,
    companyId: input.companyId,
    email: input.admin.email,
    name: input.admin.name,
    role: 'ADMIN',
    branchIds: [],
    locationIds: [location.id],
    passwordHash: input.admin.passwordHash,
    status: 'active',
  });
  if (!users.some((row) => row.id === input.admin.id)) {
    users.push({
      id: input.admin.id,
      email: input.admin.email,
      name: input.admin.name,
      role: 'ADMIN',
      assignedLocationIds: [location.id],
    });
  }
  await persistEnterpriseUser({
    id: input.admin.id,
    name: input.admin.name,
    email: input.admin.email,
    passwordHash: input.admin.passwordHash,
    role: 'ADMIN',
    locationIds: [location.id],
    companyId: input.companyId,
  });
  return { location };
}
