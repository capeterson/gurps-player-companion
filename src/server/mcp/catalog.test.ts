import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { z } from 'zod';
import { assertExactCoverage, buildToolCatalog, toJsonSchema } from './catalog.ts';
import { type IncludedOperation, TOOLS } from './operationManifest.ts';

const policy: IncludedOperation = {
  kind: 'tool',
  method: 'POST',
  path: '/example/{id}',
  tool: 'example',
  scope: 'gpc:write',
  destructive: false,
  handler: 'shared-openapi-handler',
  schemaSource: 'openapi-zod-registry',
  parityTests: [
    'src/server/mcp/parity.integration.test.ts#executes-success-and-rest-differential',
    'src/server/mcp/parity.integration.test.ts#enforces-declared-oauth-scope',
  ],
};
function document(schema: unknown) {
  return {
    paths: {
      [policy.path]: {
        post: {
          parameters: [
            { in: 'path', name: 'id', required: true, schema: { type: 'string', format: 'uuid' } },
          ],
          requestBody: { required: true, content: { 'application/json': { schema } } },
          responses: {
            200: { content: { 'application/json': { schema } } },
            204: { description: 'Empty' },
          },
        },
      },
    },
  };
}
function runtime(schema: unknown) {
  const result = buildToolCatalog(document(schema), [], [policy])[0];
  if (!result) throw new Error('missing tool');
  return result;
}

describe('MCP canonical schema conversion', () => {
  test('compiles the complete committed player API catalog, including unconstrained nullable history values', () => {
    const snapshot = JSON.parse(readFileSync('docs/openapi.json', 'utf8'));
    const tools = buildToolCatalog(snapshot);
    expect(tools.length).toBe(TOOLS.length);
    expect(tools.length).toBeGreaterThan(80);
    for (const tool of tools) {
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.outputSchema.type).toBe('object');
    }
  });

  test('preserves nullable refs, unconstrained values, enums and exclusive numeric bounds', () => {
    const ajv = new Ajv({ strict: false });
    const schema = toJsonSchema({
      type: 'object',
      properties: {
        ref: { $ref: '#/components/schemas/Name', nullable: true },
        anything: { nullable: true },
        option: { type: 'string', enum: ['yes'], nullable: true },
        amount: {
          type: 'number',
          minimum: 0,
          exclusiveMinimum: true,
          maximum: 2,
          exclusiveMaximum: true,
        },
      },
      $defs: { Name: { type: 'string', minLength: 2 } },
    });
    const validate = ajv.compile(schema as object);
    expect(validate({ ref: null, anything: 123, option: null, amount: 1 })).toBe(true);
    expect(validate({ ref: 'a' })).toBe(false);
    expect(validate({ ref: 'ab', option: 'no' })).toBe(false);
    expect(validate({ amount: 0 })).toBe(false);
    expect(validate({ amount: 2 })).toBe(false);
  });

  test('includes transitive reachable definitions once and rejects broken references', () => {
    const input = document({ $ref: '#/components/schemas/A' });
    const complete = {
      ...input,
      components: {
        schemas: {
          A: { type: 'object', properties: { child: { $ref: '#/components/schemas/B' } } },
          B: { type: 'string' },
          Unrelated: { type: 'number' },
        },
      },
    };
    const tool = buildToolCatalog(complete, [], [policy])[0];
    expect(Object.keys(tool?.inputSchema.$defs as object).sort()).toEqual(['A', 'B']);
    expect(JSON.stringify(tool)).not.toContain('Unrelated');
    expect(() => buildToolCatalog(input, [], [policy])).toThrow('Missing MCP schema definition');
  });

  test('validates UUIDs, dates, bounds and required input without mutating defaults', () => {
    const tool = runtime({
      type: 'object',
      required: ['at'],
      properties: {
        at: { type: 'string', format: 'date-time' },
        count: { type: 'integer', minimum: 1, default: 2 },
      },
    });
    const input = {
      path: { id: '0198aa77-1111-7111-8111-111111111111' },
      body: { at: '2026-09-12T00:00:00Z' },
    };
    expect(tool.validateInput(input)).toBe(true);
    expect(input.body).not.toHaveProperty('count');
    expect(tool.validateInput({ ...input, path: { id: 'not-a-uuid' } })).toBe(false);
    expect(tool.validateInput({ ...input, body: { at: 'not-a-date' } })).toBe(false);
    expect(tool.validateInput({ ...input, body: { at: input.body.at, count: 0 } })).toBe(false);
  });

  test('advertises operation-specific success shapes and keeps API error payloads', async () => {
    const tool = runtime({
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
    });
    const ajv = new Ajv({ strict: false });
    addFormats(ajv);
    const output = ajv.compile(tool.outputSchema);
    expect(output({ status: 200, contentType: 'application/json', body: { name: 'Ada' } })).toBe(
      true,
    );
    expect(output({ status: 200, contentType: 'application/json', body: { other: 1 } })).toBe(
      false,
    );
    expect(await tool.validateResponse(200, 'application/json', null)).not.toBeNull();
    expect(await tool.validateResponse(204, '', null)).toBeNull();
    expect(await tool.validateResponse(204, '', 'unexpected')).not.toBeNull();
    expect(await tool.validateResponse(201, 'application/json', { name: 'Ada' })).not.toBeNull();
    expect(
      await tool.validateResponse(403, 'application/json', { error: 'owner required' }),
    ).toBeNull();
    expect(
      await tool.validateResponse(422, 'application/json', {
        error: 'validation_error',
        issues: [{ path: 'name' }],
      }),
    ).toBeNull();
    expect(await tool.validateResponse(500, 'text/html', '<html>')).not.toBeNull();
  });

  test('uses original Zod refinements that cannot be represented in OpenAPI', async () => {
    const schema = z
      .object({ a: z.number(), b: z.number() })
      .refine((row) => row.a < row.b, 'a must precede b');
    const jsonSchema = {
      type: 'object',
      properties: { a: { type: 'number' }, b: { type: 'number' } },
      required: ['a', 'b'],
    };
    const tool = buildToolCatalog(
      document(jsonSchema),
      [
        {
          type: 'route',
          route: {
            method: 'post',
            path: policy.path,
            responses: { 200: { content: { 'application/json': { schema } } } },
          },
        },
      ],
      [policy],
    )[0];
    expect(
      await tool?.validateResponse(200, 'application/json; charset=utf-8', { a: 1, b: 2 }),
    ).toBeNull();
    expect(await tool?.validateResponse(200, 'application/json', { a: 2, b: 1 })).toContain(
      'a must precede b',
    );
  });

  test('retains typed YAML responses', async () => {
    const input = {
      paths: {
        [policy.path]: {
          post: {
            responses: {
              200: { content: { 'text/yaml': { schema: { type: 'string' } } } },
            },
          },
        },
      },
    };
    const tool = buildToolCatalog(input, [], [policy])[0];
    expect(await tool?.validateResponse(200, 'text/yaml; charset=utf-8', 'version: 1')).toBeNull();
    expect(await tool?.validateResponse(200, 'text/yaml', {})).not.toBeNull();
  });
});

describe('MCP exact operation coverage', () => {
  test('rejects new HTTP methods, removed operations and duplicate manifest entries', () => {
    const input = document({ type: 'string' });
    expect(() => assertExactCoverage(input, [policy])).not.toThrow();
    const changed = { paths: { ...input.paths, '/new': { put: { responses: {} } } } };
    expect(() => assertExactCoverage(changed, [policy])).toThrow('PUT /new');
    expect(() => assertExactCoverage({ paths: {} }, [policy])).toThrow(
      'removed: POST /example/{id}',
    );
    expect(() => assertExactCoverage(input, [policy, policy])).toThrow('duplicates: POST');
  });
});
