import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

const matchSchema = z.object({ tool: z.string(), arguments: z.record(z.unknown()).optional() });
const checkSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('outcome'),
    value: z.union([z.string(), z.array(z.string()).min(1)]),
  }),
  z.object({ kind: z.literal('no_mutations') }),
  z.object({
    kind: z.literal('calls'),
    match: matchSchema,
    min: z.number().int().nonnegative().default(0),
    max: z.number().int().nonnegative().optional(),
  }),
  z.object({ kind: z.literal('mutation_set'), matches: z.array(matchSchema) }),
  z.object({ kind: z.literal('forbidden_call'), match: matchSchema }),
  z.object({
    kind: z.literal('proposal_count'),
    min: z.number().int().nonnegative().default(0),
    max: z.number().int().nonnegative().optional(),
  }),
  z.object({
    kind: z.literal('skill_budget'),
    maximum: z.number().nonnegative(),
    characterId: z.string().uuid(),
    baseline: z.record(z.number().nonnegative()),
  }),
  z.object({ kind: z.literal('read_after_mutations'), tool: z.string() }),
  z.object({ kind: z.literal('only_body_keys'), match: matchSchema, keys: z.array(z.string()) }),
  z.object({
    kind: z.literal('value_absent'),
    match: matchSchema,
    path: z.string(),
    value: z.string(),
  }),
  z.object({
    kind: z.literal('argument_values'),
    match: matchSchema,
    path: z.string(),
    values: z.array(z.unknown()),
    allowMissing: z.boolean().default(false),
  }),
  z.object({ kind: z.literal('stable_retry'), match: matchSchema }),
  z.object({
    kind: z.literal('fact'),
    path: z.string(),
    value: z.unknown(),
    alternatives: z.array(z.unknown()).optional(),
  }),
]);
const scenarioSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  prompt: z.string().min(1),
  replies: z.array(
    z.object({
      id: z.string(),
      tool: z.string(),
      match: z.record(z.unknown()),
      requires: z.array(z.string()).default([]),
      response: z.object({
        status: z.union([z.number().int(), z.literal('response_lost')]),
        body: z.unknown(),
      }),
    }),
  ),
  checks: z.array(checkSchema).min(1),
});
const callSchema = z
  .object({ tool: z.string(), arguments: z.record(z.unknown()), reply: z.string() })
  .strict();
export const traceSchema = z
  .object({
    caseId: z.string(),
    calls: z.array(callSchema),
    proposals: z.array(matchSchema.extend({ arguments: z.record(z.unknown()) })).default([]),
    outcome: z.enum(['proposed', 'applied', 'blocked', 'needs_info', 'partial']),
    facts: z.record(z.unknown()).default({}),
    answer: z.string().min(1),
  })
  .strict();

/** Match a rubric's relevant fields while allowing other valid arguments. */
export function matches(value, expected) {
  if (Array.isArray(expected))
    return (
      Array.isArray(value) &&
      value.length === expected.length &&
      expected.every((item, i) => matches(value[i], item))
    );
  if (expected && typeof expected === 'object')
    return Boolean(
      value &&
        typeof value === 'object' &&
        Object.entries(expected).every(
          ([key, item]) => Object.hasOwn(value, key) && matches(value[key], item),
        ),
    );
  return Object.is(value, expected);
}
function at(value, path) {
  return path.split('.').reduce((part, key) => part?.[key], value);
}
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, stable(item)]),
    );
  return value;
}

export function loadSuite(root = process.cwd()) {
  const catalog = JSON.parse(readFileSync(join(root, 'docs/mcp-tools.json'), 'utf8'));
  const ajv = new Ajv({ strict: false, allErrors: true });
  addFormats(ajv);
  const tools = new Map(
    catalog.tools.map((tool) => [tool.name, { ...tool, validate: ajv.compile(tool.inputSchema) }]),
  );
  const cases = [];
  for (const name of readdirSync(join(root, 'skills')).sort()) {
    if (!name.startsWith('gpc-')) continue;
    const skillPath = join(root, 'skills', name, 'SKILL.md');
    const skill = readFileSync(skillPath, 'utf8');
    const frontmatter = /^---\n([\s\S]*?)\n---\n/.exec(skill);
    if (!frontmatter) throw new Error(`Missing skill frontmatter: ${name}`);
    const metadata = parseYaml(frontmatter[1]);
    if (
      metadata.name !== name ||
      !/^[a-z0-9-]{1,64}$/.test(name) ||
      typeof metadata.description !== 'string' ||
      !metadata.description.trim()
    )
      throw new Error(`Invalid skill metadata: ${name}`);
    const evals = JSON.parse(readFileSync(join(root, 'skills', name, 'evals/evals.json'), 'utf8'));
    if (evals.skill_name !== name || !Array.isArray(evals.evals) || evals.evals.length === 0)
      throw new Error(`Missing evals: ${name}`);
    for (const raw of evals.evals) {
      const scenario = scenarioSchema.parse(raw);
      if (cases.some((item) => item.id === scenario.id))
        throw new Error(`Duplicate case: ${scenario.id}`);
      const ids = new Set();
      for (const reply of scenario.replies) {
        if (!tools.has(reply.tool)) throw new Error(`Unknown fixture tool: ${reply.tool}`);
        if (ids.has(reply.id) || reply.requires.some((id) => !ids.has(id)))
          throw new Error(`Invalid fixture dependency: ${scenario.id}/${reply.id}`);
        ids.add(reply.id);
      }
      // Rubrics must also refer to tools that actually exist in this revision.
      for (const check of scenario.checks) {
        for (const tool of [
          check.tool,
          check.match?.tool,
          ...(check.matches ?? []).map((item) => item.tool),
        ].filter(Boolean)) {
          if (!tools.has(tool)) throw new Error(`Unknown rubric tool: ${tool}`);
        }
      }
      cases.push({ ...scenario, skill: name, skillPath });
    }
  }
  if (!cases.length) throw new Error('No skill evals discovered');
  return { root, cases, tools };
}
function operation(tool, call) {
  return tool?.actions
    ? tool.actions.find((item) => item.action === call.arguments.action)?.operation
    : tool?.operation;
}
function isMutation(suite, call) {
  return !operation(suite.tools.get(call.tool), call)?.startsWith('GET ');
}

export function gradeTrace(suite, raw) {
  const parsed = traceSchema.safeParse(raw);
  if (!parsed.success)
    return { caseId: raw?.caseId ?? null, passed: false, failures: [parsed.error.message] };
  const trace = parsed.data;
  const scenario = suite.cases.find((item) => item.id === trace.caseId);
  if (!scenario) return { caseId: trace.caseId, passed: false, failures: ['Unknown case ID'] };
  const failures = [];
  const seen = new Set();
  for (const call of [...trace.calls, ...trace.proposals]) {
    const tool = suite.tools.get(call.tool);
    if (!tool || !tool.validate(structuredClone(call.arguments)))
      failures.push(
        `Invalid ${call.tool} arguments: ${JSON.stringify(tool?.validate.errors ?? 'unknown tool')}`,
      );
  }
  for (const call of trace.calls) {
    const reply = scenario.replies.find((item) => item.id === call.reply);
    if (!reply || reply.tool !== call.tool || !matches(call.arguments, reply.match))
      failures.push(`Call does not match supplied reply: ${call.reply}`);
    else if (reply.requires.some((id) => !seen.has(id)))
      failures.push(`Reply used before its prerequisites: ${call.reply}`);
    seen.add(call.reply);
  }
  const mutations = trace.calls.filter((call) => isMutation(suite, call));
  for (const call of mutations)
    if (typeof call.arguments.idempotencyKey !== 'string' || !call.arguments.idempotencyKey.trim())
      failures.push('Mutation needs an idempotency key');
  if (
    trace.outcome === 'applied' &&
    mutations.some((call) => {
      const reply = scenario.replies.find((item) => item.id === call.reply);
      const status = reply?.response.status;
      if (status === 'response_lost')
        return !mutations.some(
          (later) =>
            mutations.indexOf(later) > mutations.indexOf(call) &&
            later.tool === call.tool &&
            JSON.stringify(stable(later.arguments)) === JSON.stringify(stable(call.arguments)) &&
            typeof scenario.replies.find((item) => item.id === later.reply)?.response.status ===
              'number' &&
            scenario.replies.find((item) => item.id === later.reply).response.status >= 200 &&
            scenario.replies.find((item) => item.id === later.reply).response.status < 300,
        );
      return typeof status !== 'number' || status < 200 || status >= 300;
    })
  )
    failures.push('Claimed full completion despite an unconfirmed or rejected write');
  for (const check of scenario.checks) {
    let pass = false;
    switch (check.kind) {
      case 'outcome':
        pass = Array.isArray(check.value)
          ? check.value.includes(trace.outcome)
          : trace.outcome === check.value;
        break;
      case 'no_mutations':
        pass = mutations.length === 0;
        break;
      case 'calls': {
        const count = trace.calls.filter((call) => matches(call, check.match)).length;
        pass = count >= check.min && (check.max === undefined || count <= check.max);
        break;
      }
      case 'mutation_set': {
        const remaining = [...mutations];
        pass =
          remaining.length === check.matches.length &&
          check.matches.every((pattern) => {
            const index = remaining.findIndex((call) => matches(call, pattern));
            if (index < 0) return false;
            remaining.splice(index, 1);
            return true;
          });
        break;
      }
      case 'forbidden_call':
        pass = ![...trace.calls, ...trace.proposals].some((call) => matches(call, check.match));
        break;
      case 'proposal_count':
        pass =
          trace.proposals.length >= check.min &&
          (check.max === undefined || trace.proposals.length <= check.max);
        break;
      case 'skill_budget': {
        let total = 0;
        const ids = new Set();
        pass =
          trace.proposals.every((call) => {
            const id = call.arguments.path?.skillId;
            const points = call.arguments.body?.points;
            const previous = check.baseline[id];
            if (
              call.tool !== 'character_skill' ||
              call.arguments.action !== 'update' ||
              call.arguments.path?.id !== check.characterId ||
              typeof previous !== 'number' ||
              !Number.isInteger(points) ||
              points < previous ||
              ids.has(id) ||
              Object.keys(call.arguments.body).some((key) => key !== 'points')
            )
              return false;
            ids.add(id);
            total += points - previous;
            return true;
          }) &&
          total > 0 &&
          total <= check.maximum;
        break;
      }
      case 'read_after_mutations': {
        const last = trace.calls.findLastIndex((call) => isMutation(suite, call));
        pass =
          last >= 0 &&
          trace.calls.some(
            (call, index) => index > last && call.tool === check.tool && !isMutation(suite, call),
          );
        break;
      }
      case 'only_body_keys':
        pass = mutations
          .filter((call) => matches(call, check.match))
          .every((call) =>
            Object.keys(call.arguments.body ?? {}).every((key) => check.keys.includes(key)),
          );
        break;
      case 'value_absent':
        pass = trace.calls
          .filter((call) => matches(call, check.match))
          .every((call) => !JSON.stringify(at(call, check.path) ?? '').includes(check.value));
        break;
      case 'argument_values':
        pass = trace.calls
          .filter((call) => matches(call, check.match))
          .every((call) => {
            const value = at(call, check.path);
            return value === undefined
              ? check.allowMissing
              : check.values.some((allowed) => matches(value, allowed));
          });
        break;
      case 'stable_retry': {
        const calls = mutations.filter((call) => matches(call, check.match));
        pass =
          calls.length === 2 &&
          JSON.stringify(stable(calls[0].arguments)) === JSON.stringify(stable(calls[1].arguments));
        break;
      }
      case 'fact':
        pass = [check.value, ...(check.alternatives ?? [])].some((value) =>
          matches(at(trace.facts, check.path), value),
        );
        break;
    }
    if (!pass) failures.push(`Failed ${check.kind}: ${JSON.stringify(check)}`);
  }
  return { caseId: trace.caseId, skill: scenario.skill, passed: failures.length === 0, failures };
}

export function gradeAll(suite, traces) {
  if (!Array.isArray(traces)) throw new Error('Candidate file must be a JSON array');
  const results = traces.map((trace) => gradeTrace(suite, trace));
  for (const scenario of suite.cases) {
    const count = traces.filter((trace) => trace.caseId === scenario.id).length;
    if (count !== 1)
      results.push({
        caseId: scenario.id,
        passed: false,
        failures: [count ? 'Duplicate trace' : 'Missing trace'],
      });
  }
  return {
    passed: results.every((result) => result.passed),
    scenarios: suite.cases.length,
    results,
  };
}
const skillTools = {
  'gpc-character-advancement': [
    'list_characters',
    'list_campaigns',
    'get_character',
    'get_campaign',
    'get_campaign_library',
    'character',
    'character_skill',
    'character_trait',
    'character_spell',
    'character_language',
    'character_technique',
  ],
  'gpc-loadout': [
    'list_characters',
    'get_character',
    'get_campaign',
    'get_campaign_library',
    'character_inventory',
  ],
  'gpc-library-authoring': [
    'get_campaign',
    'get_campaign_library',
    'library_skill',
    'library_trait',
    'library_item',
    'library_source',
  ],
  'gpc-session-wrap-up': [
    'get_campaign',
    'get_character',
    'list_adventure_log',
    'adventure_log_entry',
    'character_inventory',
  ],
  'gpc-encounter-prep': [
    'get_campaign',
    'list_encounters',
    'get_encounter',
    'encounter',
    'encounter_combatant',
    'encounter_effect',
  ],
};

export function prepare(suite, output) {
  mkdirSync(output, { recursive: true });
  for (const scenario of suite.cases) {
    const names = new Set([
      ...(skillTools[scenario.skill] ?? []),
      ...scenario.replies.map((reply) => reply.tool),
    ]);
    // Do not export rubrics, control traces, or prior answers to the model.
    writeFileSync(
      join(output, `${scenario.id}.json`),
      `${JSON.stringify(
        {
          caseId: scenario.id,
          skillPath: scenario.skillPath,
          prompt: scenario.prompt,
          replies: scenario.replies,
          tools: [...names].map((name) => ({
            name,
            inputSchema: suite.tools.get(name).inputSchema,
          })),
          traceFormat: {
            caseId: scenario.id,
            calls: [{ tool: 'canonical name', arguments: {}, reply: 'supplied reply ID' }],
            proposals: [{ tool: 'canonical name', arguments: {} }],
            outcome: 'proposed | applied | blocked | needs_info | partial',
            facts: {},
            answer: 'Your response to the user',
          },
          instructions:
            'Forward-test the skill in a synthetic environment. Record calls in order using the supplied reply IDs; replies are relevant-field projections, and omitted fields are unspecified. Honor fixture prerequisites. Proposals are unexecuted writes, each shaped as {tool, arguments} with full arguments matching that tool schema; use an empty array when there is no concrete proposed write. Do not call a live service. Export a JSON trace; include carriedWeightLbs/encumbrance facts for packing advice, and logPosted/lootAdded facts for partial session writes when applicable.',
        },
        null,
        2,
      )}\n`,
    );
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command = 'validate', path] = process.argv.slice(2);
  const suite = loadSuite();
  if (command === 'validate')
    console.log(
      `Validated ${suite.cases.length} eval scenarios across ${new Set(suite.cases.map((item) => item.skill)).size} skills.`,
    );
  else if (command === 'list')
    console.log(
      JSON.stringify(
        suite.cases.map(({ id, skill }) => ({ id, skill })),
        null,
        2,
      ),
    );
  else if (command === 'prepare' && path) {
    prepare(suite, resolve(path));
    console.log(`Prepared ${suite.cases.length} blind inputs in ${path}`);
  } else if (command === 'grade' && path) {
    const report = gradeAll(suite, JSON.parse(readFileSync(path, 'utf8')));
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.passed ? 0 : 1;
  } else
    throw new Error(
      `Usage: bun run ${fileURLToPath(import.meta.url)} validate|list|prepare <output-dir>|grade <traces.json>`,
    );
}
