import Ajv, { type ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import {
  type IncludedOperation,
  OPERATION_POLICY,
  type OperationPolicy,
  TOOLS,
  operationKey,
} from './operationManifest.ts';

type JsonSchema = Record<string, unknown>;
type Content = Record<string, { schema?: JsonSchema }>;
type OpenApiOperation = {
  summary?: string;
  description?: string;
  parameters?: Array<Record<string, unknown>>;
  requestBody?: { required?: boolean; content?: Content };
  responses?: Record<string, { content?: Content }>;
};
type OpenApiDocument = {
  paths?: Record<string, Record<string, OpenApiOperation>>;
  components?: { schemas?: Record<string, JsonSchema> };
};
type ResponseValidator = {
  safeParseAsync(value: unknown): Promise<{
    success: boolean;
    error?: { message: string };
  }>;
};
type RegistryDefinition = {
  type: string;
  route?: {
    method: string;
    path: string;
    responses?: Record<string, { content?: Record<string, { schema?: ResponseValidator }> }>;
  };
};

export interface RuntimeTool {
  policy: IncludedOperation;
  description: string;
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
  validateInput: ValidateFunction;
  validateResponse(status: number, contentType: string, body: unknown): Promise<string | null>;
}

/** OpenAPI 3.0's nullable/exclusive-bound vocabulary is not JSON Schema. */
export function toJsonSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(toJsonSchema);
  if (!value || typeof value !== 'object') return value;
  const source = value as JsonSchema;
  const converted: JsonSchema = {};
  for (const [key, child] of Object.entries(source)) {
    if (key === 'nullable' && typeof child === 'boolean') continue;
    if ((key === 'exclusiveMinimum' || key === 'exclusiveMaximum') && typeof child === 'boolean') {
      continue;
    }
    converted[key] =
      key === '$ref' && typeof child === 'string'
        ? child.replace(/^#\/components\/schemas\//, '#/$defs/')
        : toJsonSchema(child);
  }
  for (const bound of ['Minimum', 'Maximum'] as const) {
    const inclusive = bound.toLowerCase();
    if (source[`exclusive${bound}`] === true && typeof source[inclusive] === 'number') {
      converted[`exclusive${bound}`] = source[inclusive];
      delete converted[inclusive];
    }
  }
  return source.nullable === true ? { anyOf: [converted, { type: 'null' }] } : converted;
}

function bundled(schema: JsonSchema, definitions: Record<string, JsonSchema>): JsonSchema {
  const selected: Record<string, JsonSchema> = {};
  const visited = new Set<string>();
  const scan = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(scan);
    } else if (value && typeof value === 'object') {
      const object = value as JsonSchema;
      if (typeof object.$ref === 'string') {
        const match = /^#\/components\/schemas\/(.+)$/.exec(object.$ref);
        if (!match?.[1]) throw new Error(`Unsupported MCP schema reference: ${object.$ref}`);
        const pointer = match[1];
        const name = pointer.replace(/~1/g, '/').replace(/~0/g, '~');
        if (!visited.has(name)) {
          const definition = definitions[name];
          if (!definition) throw new Error(`Missing MCP schema definition: ${name}`);
          visited.add(name);
          selected[name] = definition;
          scan(definition);
        }
      }
      Object.values(object).forEach(scan);
    }
  };
  scan(schema);
  return toJsonSchema({ ...schema, ...(visited.size ? { $defs: selected } : {}) }) as JsonSchema;
}

function requestSchema(
  operation: OpenApiOperation,
  definitions: Record<string, JsonSchema>,
): JsonSchema {
  const properties: JsonSchema = {};
  const required: string[] = [];
  for (const location of ['path', 'query'] as const) {
    const fields: JsonSchema = {};
    const requiredFields: string[] = [];
    for (const parameter of operation.parameters ?? []) {
      if (parameter.in !== location || typeof parameter.name !== 'string') continue;
      fields[parameter.name] = parameter.schema ?? {};
      if (parameter.required === true) requiredFields.push(parameter.name);
    }
    if (Object.keys(fields).length) {
      properties[location] = {
        type: 'object',
        properties: fields,
        required: requiredFields,
        additionalProperties: false,
      };
      if (requiredFields.length) required.push(location);
    }
  }
  const bodyContents = Object.values(operation.requestBody?.content ?? {});
  if (bodyContents.length) {
    // GPC's player API accepts JSON request bodies, including the YAML import
    // envelope. New media types need an explicit executor mapping, not guessing.
    const content = operation.requestBody?.content?.['application/json'];
    if (!content?.schema) throw new Error('MCP request body needs an explicit JSON media mapping');
    properties.body = content.schema;
    if (operation.requestBody?.required) required.push('body');
  }
  properties.idempotencyKey = {
    type: 'string',
    minLength: 1,
    maxLength: 200,
    description: 'Stable mutation retry key. Reuse only with identical input.',
  };
  return bundled(
    { type: 'object', properties, required, additionalProperties: false },
    definitions,
  );
}

// Hono middleware and authorization helpers can return these errors even when
// an individual resource's OpenAPI response list omits that status. Preserve
// their full payload (including field issues), never turn a 403 into a schema error.
const sharedErrorBody: JsonSchema = {
  type: 'object',
  properties: { error: { type: 'string' } },
  required: ['error'],
};

function outputSchema(
  operation: OpenApiOperation,
  definitions: Record<string, JsonSchema>,
): JsonSchema {
  const variants: JsonSchema[] = [];
  for (const [status, response] of Object.entries(operation.responses ?? {})) {
    const statusSchema = /^\d{3}$/.test(status) ? { const: Number(status) } : { type: 'integer' };
    const contents = Object.entries(response.content ?? {});
    if (!contents.length) {
      variants.push({ properties: { status: statusSchema, body: { type: 'null' } } });
    }
    for (const [, content] of contents) {
      if (!content.schema) throw new Error(`Missing output schema for response ${status}`);
      variants.push({ properties: { status: statusSchema, body: content.schema } });
    }
  }
  variants.push({
    properties: {
      status: { type: 'integer', minimum: 400, maximum: 599 },
      body: sharedErrorBody,
    },
  });
  return bundled(
    {
      type: 'object',
      properties: {
        status: { type: 'integer', minimum: 100, maximum: 599 },
        contentType: { type: ['string', 'null'] },
        body: {},
      },
      required: ['status', 'contentType', 'body'],
      additionalProperties: false,
      anyOf: variants,
    },
    definitions,
  );
}

function mediaType(value: string): string {
  return value.split(';', 1)[0]?.trim().toLowerCase() ?? '';
}

// Many sub-resource writes return the same character-detail schema. Reuse
// validators rather than compiling that large graph once for every tool/app.
const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
for (const format of ['int32', 'int64', 'float', 'double']) ajv.addFormat(format, true);
const compiled = new Map<string, ValidateFunction>();
function compile(schema: JsonSchema): ValidateFunction {
  const key = JSON.stringify(schema);
  const cached = compiled.get(key);
  if (cached) return cached;
  const validator = ajv.compile(schema);
  ajv.removeSchema(schema);
  if (compiled.size >= 512) {
    const oldest = compiled.keys().next().value;
    if (oldest !== undefined) compiled.delete(oldest);
  }
  compiled.set(key, validator);
  return validator;
}

export function buildToolCatalog(
  rawDocument: unknown,
  registryDefinitions: readonly unknown[] = [],
  policies: readonly IncludedOperation[] = TOOLS,
): RuntimeTool[] {
  const document = rawDocument as OpenApiDocument;
  const definitions = document.components?.schemas ?? {};
  const genericError = compile(sharedErrorBody);
  const registry = registryDefinitions as readonly RegistryDefinition[];
  return policies.map((policy) => {
    const operation = document.paths?.[policy.path]?.[policy.method.toLowerCase()];
    if (!operation)
      throw new Error(
        `MCP manifest references missing operation ${operationKey(policy.method, policy.path)}`,
      );
    const original = registry.find(
      (entry) =>
        entry.type === 'route' &&
        entry.route?.method.toUpperCase() === policy.method &&
        entry.route.path === policy.path,
    )?.route;
    const inputSchema = requestSchema(operation, definitions);
    const output = outputSchema(operation, definitions);
    // Compile the advertised output too: a valid response validator is not
    // enough if clients cannot compile the actual tools/list definition.
    compile(output);
    const responseValidators = new Map<string, ValidateFunction>();
    for (const [status, response] of Object.entries(operation.responses ?? {})) {
      for (const [type, content] of Object.entries(response.content ?? {})) {
        if (content.schema)
          responseValidators.set(
            `${status}:${type}`,
            compile(bundled(content.schema, definitions)),
          );
      }
    }
    return {
      policy,
      description: operation.description ?? operation.summary ?? `${policy.method} ${policy.path}`,
      inputSchema,
      outputSchema: output,
      validateInput: compile(inputSchema),
      async validateResponse(status, contentType, body) {
        const statusKey = operation.responses?.[status] ? String(status) : 'default';
        const response = operation.responses?.[statusKey];
        const type = mediaType(contentType);
        if (response && !Object.keys(response.content ?? {}).length) {
          return body === null ? null : `Response ${status} must have no body`;
        }
        const validator = responseValidators.get(`${statusKey}:${type}`);
        if (!validator) {
          if (status >= 400 && status <= 599 && type === 'application/json' && genericError(body))
            return null;
          return `OpenAPI has no ${status} ${type || '(no content type)'} response contract`;
        }
        if (!validator(body)) return ajv.errorsText(validator.errors, { separator: '; ' });
        const schema = original?.responses?.[statusKey]?.content?.[type]?.schema;
        if (schema?.safeParseAsync) {
          const result = await schema.safeParseAsync(body);
          if (!result.success)
            return result.error?.message ?? 'Response failed shared Zod validation';
        }
        return null;
      },
    } satisfies RuntimeTool;
  });
}

export function assertExactCoverage(
  rawDocument: unknown,
  policies: readonly OperationPolicy[] = OPERATION_POLICY,
): void {
  const document = rawDocument as OpenApiDocument;
  const emitted = new Set<string>();
  for (const [path, pathItem] of Object.entries(document.paths ?? {})) {
    for (const method of Object.keys(pathItem)) {
      if (!['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace'].includes(method))
        continue;
      emitted.add(operationKey(method, path));
    }
  }
  const keys = policies.map((entry) => operationKey(entry.method, entry.path));
  const mapped = new Set(keys);
  const duplicates = keys.filter((key, index) => keys.indexOf(key) !== index);
  const missing = [...emitted].filter((key) => !mapped.has(key));
  const removed = [...mapped].filter((key) => !emitted.has(key));
  const names = policies.flatMap((entry) => (entry.kind === 'tool' ? [entry.tool] : []));
  const collisions = names.filter((name, index) => names.indexOf(name) !== index);
  if (missing.length || removed.length || collisions.length || duplicates.length) {
    throw new Error(
      `MCP coverage drift\nmissing: ${missing.join(', ') || '(none)'}\nremoved: ${removed.join(', ') || '(none)'}\nduplicates: ${duplicates.join(', ') || '(none)'}\ncollisions: ${[...new Set(collisions)].join(', ') || '(none)'}`,
    );
  }
}
