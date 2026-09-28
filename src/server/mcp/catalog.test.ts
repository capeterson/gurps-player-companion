import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { z } from 'zod';
import {
  assertExactCoverage,
  buildToolCatalog,
  operationForInput,
  toJsonSchema,
  toolsForScopes,
} from './catalog.ts';
import { type IncludedOperation, TOOLS } from './operationManifest.ts';

const policy: IncludedOperation = {
  kind: 'tool',
  method: 'POST',
  path: '/example/{id}',
  tool: 'example',
  scope: 'gpc:write',
  destructive: false,
  openWorld: false,
  handler: 'shared-openapi-handler',
  schemaSource: 'openapi-zod-registry',
  resultMode: 'compact-mutation-ack',
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
    expect(tools.length).toBe(new Set(TOOLS.map((entry) => entry.tool)).size);
    expect(TOOLS.length).toBe(104);
    expect(tools.length).toBeGreaterThan(80);
    for (const tool of tools) {
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.outputSchema.type).toBe('object');
    }
  });

  test('groups media actions while keeping scope, strict input, and response contracts per operation', async () => {
    const tools = buildToolCatalog(JSON.parse(readFileSync('docs/openapi.json', 'utf8')));
    const media = tools.find((entry) => entry.policy.tool === 'gpc_media');
    expect(media).toBeDefined();
    if (!media) throw new Error('missing gpc_media tool');
    expect(media?.operations.map((entry) => entry.policy.action)).toEqual([
      'capabilities',
      'upload',
      'status',
      'cancel',
    ]);
    expect(media?.validateInput({ action: 'capabilities' })).toBe(true);
    expect(media?.validateInput({ action: 'unknown' })).toBe(false);
    expect(media?.validateInput({ action: 'capabilities', idempotencyKey: 'wrong-surface' })).toBe(
      false,
    );

    const readOnlyMedia = toolsForScopes(tools, ['gpc:read']).find(
      (entry) => entry.policy.tool === 'gpc_media',
    );
    expect(readOnlyMedia?.operations.map((entry) => entry.policy.action)).toEqual([
      'capabilities',
      'status',
    ]);
    expect(readOnlyMedia?.validateInput({ action: 'upload' })).toBe(false);

    const capabilities = operationForInput(media, { action: 'capabilities' });
    const status = operationForInput(media, { action: 'status' });
    expect(capabilities).toBeDefined();
    expect(status).toBeDefined();
    const capabilitiesBody = { enabled: true, maxInputBytes: 10_485_760 };
    const statusBody = {
      id: '0198aa77-1111-7111-8111-111111111111',
      state: 'ready',
      thumbUrl: null,
      displayUrl: null,
      width: 24,
      height: 16,
      reason: null,
    };
    expect(
      await capabilities?.validateResponse(200, 'application/json', capabilitiesBody),
    ).toBeNull();
    expect(
      await capabilities?.validateResponse(200, 'application/json', statusBody),
    ).not.toBeNull();
    expect(await status?.validateResponse(200, 'application/json', statusBody)).toBeNull();
    expect(
      await status?.validateResponse(200, 'application/json', capabilitiesBody),
    ).not.toBeNull();
    expect(await media.validateResponse(200, 'application/json', capabilitiesBody)).toContain(
      'Select a tool action',
    );
  });

  test('advertises weapon selectors and owned custom effects on the existing authoring tools', () => {
    const tools = buildToolCatalog(JSON.parse(readFileSync('docs/openapi.json', 'utf8')));
    const id = '0198aa77-1111-7111-8111-111111111111';
    const selectors = [
      { kind: 'library_item', libraryItemId: id, libraryItemName: 'Spear' },
      { kind: 'weapon_skill', skillName: 'Guns', skillSpecialty: 'Rifle' },
      { kind: 'weapon_name', weaponName: 'Spear' },
      { kind: 'inventory_item', inventoryItemId: id },
    ];
    for (const kind of ['trait', 'skill'] as const) {
      for (const command of ['create', 'update'] as const) {
        const tool = tools.find((entry) => entry.policy.tool === `gpc_${command}_library_${kind}`);
        if (!tool) throw new Error(`missing library ${kind} ${command} tool`);
        for (const weaponSelector of selectors.slice(0, 3)) {
          expect(
            tool.validateInput({
              path: { id, ...(command === 'update' ? { [`${kind}Id`]: id } : {}) },
              body: {
                name: 'Mechanics',
                ...(kind === 'trait'
                  ? { kind: 'advantage' }
                  : { attribute: 'DX', difficulty: 'A' }),
                effects: [
                  {
                    target: 'weapon_damage',
                    value: 2,
                    weaponSelector: { ...weaponSelector, modeName: 'Primary' },
                  },
                ],
              },
            }),
            tool.policy.tool,
          ).toBe(true);
        }
      }
    }
    for (const command of ['create', 'update'] as const) {
      const tool = tools.find((entry) => entry.policy.tool === `gpc_${command}_character_trait`);
      if (!tool) throw new Error(`missing character trait ${command} tool`);
      for (const weaponSelector of selectors) {
        const input = {
          path: { id, ...(command === 'update' ? { traitId: id } : {}) },
          body: {
            name: 'Owned mastery',
            kind: 'advantage',
            customEffects: [{ target: 'weapon_attack', value: 1, weaponSelector }],
          },
        };
        expect(tool.validateInput(input), tool.policy.tool).toBe(true);
        expect(tool.validateInput({ ...input, body: { ...input.body, customEffects: [] } })).toBe(
          true,
        );
        expect(tool.validateInput({ ...input, body: { ...input.body, customEffects: null } })).toBe(
          false,
        );
        expect(
          tool.validateInput({
            ...input,
            body: {
              ...input.body,
              customEffects: Array.from({ length: 51 }, () => input.body.customEffects[0]),
            },
          }),
        ).toBe(false);
      }
    }
  });

  test('advertises library specialization policies and structured default matchers', () => {
    const tools = buildToolCatalog(JSON.parse(readFileSync('docs/openapi.json', 'utf8')));
    const id = '0198aa77-1111-7111-8111-111111111111';
    for (const command of ['create', 'update'] as const) {
      const tool = tools.find((entry) => entry.policy.tool === `gpc_${command}_library_skill`);
      if (!tool) throw new Error(`missing library skill ${command} tool`);
      expect(
        tool.validateInput({
          path: { id, ...(command === 'update' ? { skillId: id } : {}) },
          body: {
            ...(command === 'create' ? { name: 'Armoury', attribute: 'IQ', difficulty: 'A' } : {}),
            specializationPolicy: {
              kind: 'required_catalog',
              options: [
                {
                  name: 'Small Arms',
                  defaults: [
                    {
                      kind: 'skill',
                      name: 'Guns',
                      specialization: { kind: 'any' },
                      modifier: -4,
                    },
                  ],
                },
              ],
            },
          },
        }),
      ).toBe(true);
      const base = {
        path: { id, ...(command === 'update' ? { skillId: id } : {}) },
        body: {
          ...(command === 'create' ? { name: 'Rules', attribute: 'IQ', difficulty: 'A' } : {}),
        },
      };
      expect(tool.validateInput({ ...base, body: { ...base.body, prerequisiteRules: null } })).toBe(
        true,
      );
      expect(
        tool.validateInput({ ...base, body: { ...base.body, prerequisiteRules: 'anything' } }),
      ).toBe(false);
      expect(
        tool.validateInput({
          ...base,
          body: {
            ...base.body,
            prerequisiteRules: { kind: 'all', children: [null] },
          },
        }),
      ).toBe(false);
    }
  });

  test('advertises bounded read filters for agent-facing collection tools', () => {
    const tools = buildToolCatalog(JSON.parse(readFileSync('docs/openapi.json', 'utf8')));
    const id = '0198aa77-1111-7111-8111-111111111111';
    for (const name of [
      'gpc_list_characters',
      'gpc_list_campaigns',
      'gpc_list_adventure_log',
      'gpc_list_encounters',
    ]) {
      const tool = tools.find((entry) => entry.policy.tool === name);
      if (!tool) throw new Error(`missing ${name}`);
      const path =
        name === 'gpc_list_adventure_log' || name === 'gpc_list_encounters' ? { path: { id } } : {};
      expect(
        tool.validateInput({ ...path, query: { search: 'dragon', limit: 25, offset: 50 } }),
        name,
      ).toBe(true);
      expect(tool.validateInput({ ...path, query: { limit: 0 } }), name).toBe(false);
    }
    const notifications = tools.find((entry) => entry.policy.tool === 'gpc_list_notifications');
    if (!notifications) throw new Error('missing gpc_list_notifications');
    expect(
      notifications.validateInput({ query: { unreadOnly: 'true', limit: 25, offset: 50 } }),
    ).toBe(true);
    const library = tools.find((entry) => entry.policy.tool === 'gpc_get_campaign_library');
    if (!library) throw new Error('missing gpc_get_campaign_library');
    expect(
      library.validateInput({
        path: { id },
        query: { section: 'skills', search: 'spear', limit: 10, offset: 20 },
      }),
    ).toBe(true);
    expect(library.inputSchema.properties).not.toHaveProperty('idempotencyKey');
    const create = tools.find((entry) => entry.policy.tool === 'gpc_create_character');
    if (!create) throw new Error('missing gpc_create_character');
    expect(create.inputSchema.properties).toHaveProperty('idempotencyKey');
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

  test('advertises compact mutation acknowledgements while validating full handler responses', async () => {
    const tool = runtime({
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
    });
    const ajv = new Ajv({ strict: false });
    addFormats(ajv);
    const output = ajv.compile(tool.outputSchema);
    expect(
      output({
        status: 200,
        contentType: 'application/json',
        body: { acknowledged: true, resourceId: '0198aa77-1111-7111-8111-111111111111' },
      }),
    ).toBe(true);
    expect(output({ status: 200, contentType: 'application/json', body: { name: 'Ada' } })).toBe(
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

  test('does not advertise full REST success definitions on mutation tools', () => {
    const snapshot = JSON.parse(readFileSync('docs/openapi.json', 'utf8'));
    const tools = buildToolCatalog(snapshot);
    const mutations = tools.filter((tool) => tool.policy.method !== 'GET');
    expect(mutations.length).toBeGreaterThan(70);
    for (const tool of mutations) {
      const output = JSON.stringify(tool.outputSchema);
      expect(tool.policy.resultMode, tool.policy.tool).toBe('compact-mutation-ack');
      expect(output, tool.policy.tool).toContain('acknowledged');
      expect(output, tool.policy.tool).not.toContain('$defs');
      expect(output.length, tool.policy.tool).toBeLessThan(2_000);
    }
    const outputBytes = tools.reduce(
      (total, tool) => total + JSON.stringify(tool.outputSchema).length,
      0,
    );
    const completeSchemaBytes = tools.reduce(
      (total, tool) =>
        total + JSON.stringify(tool.inputSchema).length + JSON.stringify(tool.outputSchema).length,
      0,
    );
    // Media tools and portrait/cover asset IDs add required, compact output fields.
    expect(outputBytes).toBeLessThan(260_000);
    // Calculator inputs plus source/modifier metadata are bounded, first-class
    // portable fields; reserve a measured 550 KB for the complete catalog while
    // still guarding against accidental schema duplication or unbounded growth.
    expect(completeSchemaBytes).toBeLessThan(550_000);
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

  test('accepts distinct explicit actions and rejects duplicate or mixed action groups', () => {
    const readAction: IncludedOperation = {
      ...policy,
      path: '/example/read',
      tool: 'example_task',
      method: 'GET',
      action: 'read',
    };
    const writeAction: IncludedOperation = {
      ...policy,
      path: '/example/write',
      tool: 'example_task',
      action: 'write',
    };
    const groupedDocument = {
      paths: {
        [readAction.path]: { get: { responses: {} } },
        [writeAction.path]: { post: { responses: {} } },
      },
    };

    expect(() => assertExactCoverage(groupedDocument, [readAction, writeAction])).not.toThrow();
    expect(() =>
      assertExactCoverage(groupedDocument, [readAction, { ...writeAction, action: 'read' }]),
    ).toThrow('collisions: example_task');
    const { action: _action, ...ungrouped } = writeAction;
    expect(() => assertExactCoverage(groupedDocument, [readAction, ungrouped])).toThrow(
      'collisions: example_task',
    );
  });
});
