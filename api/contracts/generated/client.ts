// Week 8: generated typed client for the endpoints in contracts/openapi.json.
// Regenerate with `node ../scripts/generate-contract.mjs` after editing the
// spec - do not hand-edit this file or contracts/generated/types.ts.
//
// This is a minimal typed fetch wrapper, not a full codegen client
// (openapi-typescript-codegen etc.) - it proves the "typed client compiles
// from the contract" requirement for web/mobile without adding a heavier
// codegen dependency for a contract that currently covers five endpoints.
// Extending this file's coverage tracks 1:1 with extending the OpenAPI
// spec itself as more modules are extracted.
import type { paths } from './types.js';

export type ClientConfig = { baseUrl: string; getToken: () => string | Promise<string> };

type JsonOf<T> = T extends { content: { 'application/json': infer J } } ? J : never;

async function request<T>(config: ClientConfig, method: string, path: string, body?: unknown): Promise<{ status: number; data: T }> {
  const token = await config.getToken();
  const response = await fetch(`${config.baseUrl}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = (await response.json().catch(() => ({}))) as T;
  return { status: response.status, data };
}

export function createInvexaContractClient(config: ClientConfig) {
  return {
    transfers: {
      list: () =>
        request<JsonOf<paths['/transfers/list']['get']['responses']['200']>>(config, 'GET', '/transfers/list'),
      create: (body: paths['/transfers']['post']['requestBody']['content']['application/json']) =>
        request<JsonOf<paths['/transfers']['post']['responses']['201']>>(config, 'POST', '/transfers', body),
    },
    branches: {
      list: () => request<JsonOf<paths['/branches']['get']['responses']['200']>>(config, 'GET', '/branches'),
      create: (body: paths['/branches']['post']['requestBody']['content']['application/json']) =>
        request<JsonOf<paths['/branches']['post']['responses']['201']>>(config, 'POST', '/branches', body),
      update: (id: string, body: Record<string, unknown>) =>
        request<JsonOf<paths['/branches/{id}']['patch']['responses']['200']>>(config, 'PATCH', `/branches/${id}`, body),
      archive: (id: string) =>
        request<JsonOf<paths['/branches/{id}/archive']['post']['responses']['200']>>(config, 'POST', `/branches/${id}/archive`),
    },
    items: {
      search: (params: { q?: string; status?: string; cursor?: string; limit?: number } = {}) => {
        const query = new URLSearchParams();
        if (params.q) query.set('q', params.q);
        if (params.status) query.set('status', params.status);
        if (params.cursor) query.set('cursor', params.cursor);
        if (params.limit) query.set('limit', String(params.limit));
        const qs = query.toString();
        return request<JsonOf<paths['/items/search']['get']['responses']['200']>>(config, 'GET', `/items/search${qs ? `?${qs}` : ''}`);
      },
      stockDetail: (itemId: string) =>
        request<JsonOf<paths['/items/{itemId}/stock-detail']['get']['responses']['200']>>(config, 'GET', `/items/${itemId}/stock-detail`),
      adjust: (itemId: string, body: paths['/items/{itemId}/adjust']['post']['requestBody']['content']['application/json']) =>
        request<JsonOf<paths['/items/{itemId}/adjust']['post']['responses']['201']>>(config, 'POST', `/items/${itemId}/adjust`, body),
      reverseMovement: (itemId: string, movementId: string, reason?: string) =>
        request<JsonOf<paths['/items/{itemId}/movements/{movementId}/reverse']['post']['responses']['201']>>(
          config, 'POST', `/items/${itemId}/movements/${movementId}/reverse`, reason ? { reason } : undefined,
        ),
    },
    imports: {
      createBatch: (body: paths['/imports/staged/batches']['post']['requestBody']['content']['application/json']) =>
        request<JsonOf<paths['/imports/staged/batches']['post']['responses']['201']>>(config, 'POST', '/imports/staged/batches', body),
      get: (id: string) =>
        request<JsonOf<paths['/imports/staged/batches/{id}']['get']['responses']['200']>>(config, 'GET', `/imports/staged/batches/${id}`),
      validate: (id: string) =>
        request<JsonOf<paths['/imports/staged/batches/{id}/validate']['post']['responses']['200']>>(config, 'POST', `/imports/staged/batches/${id}/validate`),
      commit: (id: string) =>
        request<JsonOf<paths['/imports/staged/batches/{id}/commit']['post']['responses']['202']>>(config, 'POST', `/imports/staged/batches/${id}/commit`),
      failures: (id: string) =>
        request<JsonOf<paths['/imports/staged/batches/{id}/failures']['get']['responses']['200']>>(config, 'GET', `/imports/staged/batches/${id}/failures`),
      reverse: (id: string, reason?: string) =>
        request<JsonOf<paths['/imports/staged/batches/{id}/reverse']['post']['responses']['200']>>(
          config, 'POST', `/imports/staged/batches/${id}/reverse`, reason ? { reason } : undefined,
        ),
    },
    reports: {
      dashboard: () =>
        request<JsonOf<paths['/reports/dashboard']['get']['responses']['200']>>(config, 'GET', '/reports/dashboard'),
      exceptions: (params: { cursor?: string; limit?: number } = {}) => {
        const query = new URLSearchParams();
        if (params.cursor) query.set('cursor', params.cursor);
        if (params.limit) query.set('limit', String(params.limit));
        const qs = query.toString();
        return request<JsonOf<paths['/reports/exceptions']['get']['responses']['200']>>(config, 'GET', `/reports/exceptions${qs ? `?${qs}` : ''}`);
      },
    },
  };
}
