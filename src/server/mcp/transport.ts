import type { OpenAPIHono } from '@hono/zod-openapi';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { AppConfig } from '../config.ts';
import {
  OAuthError,
  type OAuthPrincipal,
  mcpResource,
  resolveOAuthAccessToken,
} from '../oauth/service.ts';
import type { AppEnv } from '../openapi/app.ts';
import {
  type RuntimeTool,
  buildToolCatalog,
  operationForInput,
  toolsForScopes,
} from './catalog.ts';
import { type OperationInput, executeOperation } from './executor.ts';

export const MAX_MCP_BODY_BYTES = 14 * 1024 * 1024;
// Larger image envelopes need a process-wide bound, not only per-user rates.
let activeMcpRequests = 0;
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 120;
const rate = new Map<string, { startedAt: number; count: number }>();

export class McpBodyError extends Error {
  constructor(
    readonly status: 400 | 413,
    message: string,
  ) {
    super(message);
  }
}

/** Stop reading as soon as the limit is crossed, including chunked bodies with
 * no Content-Length. Call before a framework JSON parser buffers the request. */
export async function readBoundedMcpJson(request: Request): Promise<unknown> {
  const length = Number(request.headers.get('content-length') ?? 0);
  if (length > MAX_MCP_BODY_BYTES) throw new McpBodyError(413, 'Request body too large');
  if (!request.body) throw new McpBodyError(400, 'Parse error');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_MCP_BODY_BYTES) {
        await reader.cancel();
        throw new McpBodyError(413, 'Request body too large');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new McpBodyError(400, 'Parse error');
  }
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json(body, {
    status,
    headers: { 'cache-control': 'no-store', ...headers },
  });
}

function challenge(resource: string, error?: string, scope?: string): string {
  const metadata = new URL('/.well-known/oauth-protected-resource/mcp', resource).href;
  const fields = [`Bearer resource_metadata="${metadata}"`];
  if (error) fields.push(`error="${error}"`);
  if (scope) fields.push(`scope="${scope}"`);
  return fields.join(', ');
}

function consumeRate(key: string): boolean {
  const now = Date.now();
  for (const [name, entry] of rate) {
    if (now - entry.startedAt >= RATE_WINDOW_MS) rate.delete(name);
  }
  const current = rate.get(key);
  if (!current) {
    if (rate.size >= 10_000) return false;
    rate.set(key, { startedAt: now, count: 1 });
    return true;
  }
  current.count += 1;
  return current.count <= RATE_MAX;
}

/** Shared by discovery and the checked-in snapshot so hints cannot drift. */
export function describeMcpTool(entry: RuntimeTool) {
  const policies = entry.operations.map((operation) => operation.policy);
  const grouped = policies.some((policy) => policy.action);
  return {
    name: entry.policy.tool,
    description: entry.description,
    inputSchema: entry.inputSchema,
    outputSchema: entry.outputSchema,
    annotations: {
      readOnlyHint: policies.every((policy) => policy.method === 'GET'),
      destructiveHint: policies.some((policy) => policy.destructive),
      idempotentHint: policies.every((policy) => policy.method === 'GET'),
      openWorldHint: policies.some((policy) => policy.openWorld),
    },
    _meta: {
      ...(grouped
        ? {
            actions: policies.map((policy) => ({
              action: policy.action,
              requiredScope: policy.scope,
              operation: `${policy.method} ${policy.path}`,
              resultMode: policy.resultMode,
            })),
          }
        : {
            requiredScope: entry.policy.scope,
            operation: `${entry.policy.method} ${entry.policy.path}`,
            resultMode: entry.policy.resultMode,
          }),
    },
  };
}

type Dependencies = {
  resolvePrincipal: typeof resolveOAuthAccessToken;
  execute: typeof executeOperation;
};

export interface MutationAcknowledgement {
  acknowledged: true;
  resourceId?: string;
  revision?: number;
}

const nestedResourceKeys = [
  'trait',
  'skill',
  'spell',
  'language',
  'technique',
  'item',
  'combat',
  'combatant',
  'effect',
  'entry',
  'invitation',
  'notification',
  'encounter',
  'character',
  'campaign',
] as const;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Keep successful delegated writes small and stable. The complete REST body is
 * validated before this projection, so this function is only an agent-facing
 * acknowledgement builder, never a substitute for the canonical contract.
 */
export function mutationAcknowledgement(
  body: unknown,
  input: OperationInput,
): MutationAcknowledgement {
  const root = record(body);
  let resource = root;
  if (root && typeof root.id !== 'string') {
    resource = null;
    for (const key of nestedResourceKeys) {
      const candidate = record(root[key]);
      if (candidate && typeof candidate.id === 'string') {
        resource = candidate;
        break;
      }
    }
  }

  let resourceId = resource && typeof resource.id === 'string' ? resource.id : undefined;
  if (!resourceId) {
    const pathEntries = Object.entries(input.path ?? {});
    for (let index = pathEntries.length - 1; index >= 0; index--) {
      const [key, value] = pathEntries[index] ?? [];
      if (key && /id$/i.test(key) && typeof value === 'string') {
        resourceId = value;
        break;
      }
    }
  }
  const revision = resource?.revision;
  return {
    acknowledged: true,
    ...(resourceId ? { resourceId } : {}),
    ...(typeof revision === 'number' && Number.isInteger(revision) && revision >= 0
      ? { revision }
      : {}),
  };
}

export function createMcpHandler(
  config: AppConfig,
  app: OpenAPIHono<AppEnv>,
  openApiDocument: unknown,
  dependencies: Dependencies = {
    resolvePrincipal: resolveOAuthAccessToken,
    execute: executeOperation,
  },
): (request: Request, parsedBody?: unknown) => Promise<Response> {
  const resource = mcpResource(config);
  const tools = buildToolCatalog(openApiDocument, app.openAPIRegistry.definitions);
  const byName = new Map(tools.map((entry) => [entry.policy.tool, entry]));

  const handle = async (request: Request, routeParsedBody?: unknown): Promise<Response> => {
    const origin = request.headers.get('origin');
    if (origin && origin !== new URL(resource).origin && !config.corsOrigins.includes(origin)) {
      return json({ error: 'invalid_origin' }, 403);
    }
    if (request.method !== 'POST') {
      return json(
        {
          jsonrpc: '2.0',
          error: { code: -32000, message: 'Stateless MCP supports POST only' },
          id: null,
        },
        405,
        { allow: 'POST' },
      );
    }
    const token = /^Bearer\s+(.+)$/i.exec(request.headers.get('authorization') ?? '')?.[1]?.trim();
    if (!token)
      return json({ error: 'unauthorized' }, 401, { 'www-authenticate': challenge(resource) });
    let principal: OAuthPrincipal;
    try {
      principal = await dependencies.resolvePrincipal(config, token, resource);
    } catch (error) {
      if (error instanceof OAuthError) {
        return json({ error: 'invalid_token' }, 401, {
          'www-authenticate': challenge(resource, 'invalid_token'),
        });
      }
      // A storage outage is not a rejected credential: clients must not discard
      // a valid connection because the server could not verify it temporarily.
      return json({ error: 'temporarily_unavailable' }, 503);
    }
    if (!consumeRate(`${principal.user.id}:${principal.clientId}`)) {
      return json({ error: 'rate_limited' }, 429, { 'retry-after': '60' });
    }
    if (
      request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() !==
      'application/json'
    ) {
      return json(
        {
          jsonrpc: '2.0',
          id: null,
          error: { code: -32000, message: 'Content-Type must be application/json' },
        },
        415,
      );
    }
    let parsedBody = routeParsedBody;
    try {
      if (parsedBody === undefined) parsedBody = await readBoundedMcpJson(request);
      else if (
        new TextEncoder().encode(JSON.stringify(parsedBody)).byteLength > MAX_MCP_BODY_BYTES
      ) {
        throw new McpBodyError(413, 'Request body too large');
      }
    } catch (error) {
      if (error instanceof McpBodyError) {
        return json(
          {
            jsonrpc: '2.0',
            id: null,
            error: { code: error.status === 400 ? -32700 : -32000, message: error.message },
          },
          error.status,
        );
      }
      return json({ error: 'request_interrupted' }, 400);
    }

    // OAuth challenges belong on HTTP responses, before SDK tool dispatch. Only
    // inspect a valid tools/call envelope; the SDK diagnoses malformed envelopes.
    const call = CallToolRequestSchema.safeParse(parsedBody);
    if (call.success) {
      const entry = byName.get(call.data.params.name);
      const operation = entry && operationForInput(entry, call.data.params.arguments ?? {});
      if (operation && !principal.scopes.includes(operation.policy.scope)) {
        return json({ error: 'insufficient_scope' }, 403, {
          'www-authenticate': challenge(resource, 'insufficient_scope', operation.policy.scope),
        });
      }
    }

    const server = new Server(
      { name: 'gurps-player-companion', version: '0.1.0' },
      {
        capabilities: { tools: {} },
        instructions:
          'Tools cover the GPC player API; task tools have explicit typed actions. Mutations return a compact acknowledgement; use a read action or tool for refreshed state. Image uploads combine metadata and bytes in one call: reuse clientUploadId and identical content after a lost response, then attach resourceId through a character/campaign update. Non-media mutations accept idempotencyKey; reuse it after a lost response.',
      },
    );
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: toolsForScopes(tools, principal.scopes).map(describeMcpTool),
    }));
    server.setRequestHandler(CallToolRequestSchema, async (toolCall) => {
      const tool = byName.get(toolCall.params.name);
      if (!tool) return toolError('unknown_tool', 'Unknown tool');
      const input = (toolCall.params.arguments ?? {}) as OperationInput;
      if (!tool.validateInput(input)) {
        return toolError(
          'validation_error',
          `Invalid tool input: ${JSON.stringify(tool.validateInput.errors)}`,
          422,
        );
      }
      const runtime = operationForInput(tool, input);
      if (!runtime) return toolError('validation_error', 'Unknown tool action', 422);
      if (!principal.scopes.includes(runtime.policy.scope))
        return toolError('insufficient_scope', 'Additional consent required', 403);
      try {
        // The executor owns the database deadline and transaction settlement.
        // Do not race it against a timer that leaves an unseen mutation running.
        const response = await dependencies.execute(
          app,
          {
            user: principal.user,
            oauthClientDbId: principal.clientDbId,
            oauthClientId: principal.clientId,
            oauthGrantId: principal.grantId,
            scopes: principal.scopes,
          },
          runtime.policy,
          input,
        );
        const contentType = response.headers.get('content-type') ?? '';
        const text = await response.text();
        const body: unknown =
          text.length === 0 ? null : contentType.includes('json') ? JSON.parse(text) : text;
        const violation = await runtime.validateResponse(response.status, contentType, body);
        if (violation)
          return toolError(
            'response_contract_error',
            'The operation returned an invalid response',
            500,
          );
        const mutationBody =
          response.ok && runtime.policy.method !== 'GET'
            ? mutationAcknowledgement(body, input)
            : body;
        const resultContentType =
          response.ok && runtime.policy.method !== 'GET' ? 'application/json' : contentType || null;
        const resultText = response.ok
          ? `HTTP ${response.status}; result is available in structuredContent.`
          : text || `HTTP ${response.status}`;
        return {
          content: [{ type: 'text', text: resultText }],
          structuredContent: {
            status: response.status,
            contentType: resultContentType,
            body: mutationBody,
          },
          ...(response.ok ? {} : { isError: true }),
        };
      } catch {
        return toolError(
          'operation_failed',
          'The operation could not be completed. Reuse the same idempotency key to check a mutation outcome; otherwise refresh the affected data before trying again.',
          500,
        );
      }
    });
    const transport = new WebStandardStreamableHTTPServerTransport({
      enableJsonResponse: true,
    });
    try {
      await server.connect(transport);
      const response = await transport.handleRequest(request, {
        parsedBody,
        authInfo: {
          token,
          clientId: principal.clientId,
          scopes: principal.scopes,
          expiresAt: Math.floor(principal.expiresAt.getTime() / 1000),
          resource: new URL(principal.resource),
          extra: { userId: principal.user.id, grantId: principal.grantId },
        },
      });
      const headers = new Headers(response.headers);
      headers.set('cache-control', 'no-store');
      headers.set('access-control-expose-headers', 'WWW-Authenticate, MCP-Protocol-Version');
      return new Response(response.body, { status: response.status, headers });
    } catch {
      return json(
        { jsonrpc: '2.0', id: null, error: { code: -32603, message: 'Internal error' } },
        500,
      );
    } finally {
      await server.close();
    }
  };
  return async (request, parsedBody) => {
    if (activeMcpRequests >= 4)
      return json({ error: 'temporarily_unavailable' }, 503, { 'retry-after': '1' });
    activeMcpRequests++;
    try {
      return await handle(request, parsedBody);
    } finally {
      activeMcpRequests--;
    }
  };
}

function toolError(code: string, message: string, status = 400) {
  return {
    content: [{ type: 'text' as const, text: `${code}: ${message}` }],
    structuredContent: { status, contentType: 'application/json', body: { error: code, message } },
    isError: true,
  };
}
