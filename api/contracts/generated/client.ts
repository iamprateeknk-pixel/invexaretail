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
  };
}
