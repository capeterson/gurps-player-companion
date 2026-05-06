import type { ApiKeyCreatedResponse, ApiKeyOut } from '../../shared/schemas/apiKey.ts';
import { api } from './api.ts';

export const apiKeysApi = {
  list: () => api<ApiKeyOut[]>('/auth/api-keys'),
  create: (name: string) =>
    api<ApiKeyCreatedResponse>('/auth/api-keys', { method: 'POST', body: { name } }),
  delete: (id: string) => api<void>(`/auth/api-keys/${id}`, { method: 'DELETE' }),
};
