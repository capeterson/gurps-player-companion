/** Narrow adapter for the shared Lantern recipe and real MCP structured results.
 * Mutations expose acknowledgements; re-read the encounter to obtain combatant IDs.
 */
import type { OperationInput } from '../../mcp/executor.ts';
import { TOOLS } from '../../mcp/operationManifest.ts';
import type { LanternRequest } from './lanternCoastContent.ts';

export interface LanternToolResult {
  status: number;
  body: unknown;
}
export type LanternToolCall = (name: string, args: OperationInput) => Promise<LanternToolResult>;

export function lanternMcpRequest(call: LanternToolCall): LanternRequest {
  const request: LanternRequest = async (_actor, path, method = 'POST', body?: unknown) => {
    const segments = `/api/v1${path}`.split('/');
    let parameters: Record<string, string> = {};
    const operation = TOOLS.find((entry) => {
      if (entry.method !== method) return false;
      const template = entry.path.split('/');
      if (template.length !== segments.length) return false;
      const matches: Record<string, string> = {};
      for (let i = 0; i < template.length; i++) {
        const part = template[i] ?? '';
        const segment = segments[i] ?? '';
        if (part.startsWith('{')) matches[part.slice(1, -1)] = segment;
        else if (part !== segment) return false;
      }
      parameters = matches;
      return true;
    });
    if (!operation) throw new Error(`No MCP operation for Lantern ${method} ${path}`);
    const result = await call(operation.tool, {
      ...(Object.keys(parameters).length ? { path: parameters } : {}),
      ...(body === undefined ? {} : { body }),
    });
    if (result.status < 200 || result.status >= 300)
      throw new Error(
        `Lantern MCP ${operation.tool}: ${result.status} ${JSON.stringify(result.body)}`,
      );
    if (method === 'GET') return result.body;
    const acknowledgement = result.body as { acknowledged?: boolean; resourceId?: string };
    if (!acknowledgement?.acknowledged)
      throw new Error(`Lantern MCP ${operation.tool} did not acknowledge its mutation`);
    const id = acknowledgement.resourceId;
    if (method === 'POST' && path.endsWith('/encounters')) {
      if (!id) throw new Error('MCP encounter create omitted its resource ID');
      return request(_actor, `${path}/${id}`, 'GET');
    }
    return path.endsWith('/inventory') ? { item: { id } } : { id };
  };
  return request;
}
