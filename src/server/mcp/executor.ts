import type { OpenAPIHono } from '@hono/zod-openapi';
import { sql } from 'drizzle-orm';
import { getDb, runInDbTransaction } from '../db/client.ts';
import type { AppEnv } from '../openapi/app.ts';
import {
  type TrustedExecutionContext,
  attachTrustedExecution,
  runWithTrustedExecution,
} from '../services/executionContext.ts';
import type { IncludedOperation } from './operationManifest.ts';

export interface OperationInput {
  path?: Record<string, unknown>;
  query?: Record<string, unknown>;
  body?: unknown;
  idempotencyKey?: string;
}

class RolledBackClientResponse extends Error {
  constructor(readonly response: Response) {
    super(`shared operation returned HTTP ${response.status}`);
  }
}

function concretePath(template: string, values: Record<string, unknown>): string {
  return template.replace(/\{([^}]+)\}/g, (_match, name: string) => {
    const value = values[name];
    if (typeof value !== 'string' && typeof value !== 'number')
      throw new Error(`missing path parameter ${name}`);
    return encodeURIComponent(String(value));
  });
}

function appendQuery(url: URL, values: Record<string, unknown>): void {
  for (const [name, value] of Object.entries(values)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) url.searchParams.append(name, String(item));
    } else {
      url.searchParams.set(name, String(value));
    }
  }
}

export async function executeOperation(
  app: OpenAPIHono<AppEnv>,
  context: TrustedExecutionContext,
  operation: IncludedOperation,
  input: OperationInput,
): Promise<Response> {
  const url = new URL(concretePath(operation.path, input.path ?? {}), 'http://gpc.internal');
  appendQuery(url, input.query ?? {});
  const headers = new Headers({ accept: 'application/json, application/yaml, text/yaml' });
  if (input.body !== undefined) headers.set('content-type', 'application/json');
  if (input.idempotencyKey) headers.set('idempotency-key', input.idempotencyKey);
  const request = new Request(url, {
    method: operation.method,
    headers,
    ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
  });
  attachTrustedExecution(request, context);
  return runWithTrustedExecution(context, async () => {
    try {
      return await runInDbTransaction(async () => {
        // PostgreSQL cancels the transaction itself at the execution deadline;
        // the HTTP adapter never races a still-running mutation in JavaScript.
        await getDb().execute(sql`select set_config('statement_timeout', '30000', true)`);
        await getDb().execute(sql`select set_config('transaction_timeout', '30000', true)`);
        const response = await Promise.resolve(app.fetch(request));
        if (response.status >= 500) {
          throw new Error(`shared operation failed with HTTP ${response.status}`);
        }
        if (!response.ok) throw new RolledBackClientResponse(response.clone());
        return response;
      });
    } catch (error) {
      if (error instanceof RolledBackClientResponse) return error.response;
      throw error;
    }
  });
}
