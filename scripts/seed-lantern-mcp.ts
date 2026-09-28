/** Connector bridge: emits one MCP tool call per line and consumes its structured
 * result on stdin. It never opens a REST connection or creates additional users.
 * Run under an orchestrator with the connected GURPS tools; stdout is NDJSON.
 */
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { populateLanternCoast } from '../src/server/db/seeds/lanternCoastContent.ts';
import { lanternMcpRequest } from '../src/server/db/seeds/lanternCoastMcp.ts';
import { TOOLS } from '../src/server/mcp/operationManifest.ts';

const input = createInterface({ input: process.stdin });
const lines = input[Symbol.asyncIterator]();
const runKey = process.env.LANTERN_SEED_RUN_KEY ?? randomUUID();
let step = 0;
const request = lanternMcpRequest(async (name, args) => {
  const operation = TOOLS.find((entry) => entry.tool === name && entry.action === args.action);
  if (!operation) throw new Error(`Missing MCP operation ${name} action=${args.action ?? ''}`);
  const idempotencyKey = `${runKey}:${++step}`;
  process.stdout.write(
    `${JSON.stringify({ kind: 'call', name, args: { ...args, ...(operation.method === 'GET' ? {} : { idempotencyKey }) } })}\n`,
  );
  const line = await lines.next();
  if (line.done) throw new Error(`Bridge ended before ${name} returned a result`);
  return JSON.parse(line.value);
});
try {
  const yaml = await readFile(new URL('../bootstrap/lantern_coast.yaml', import.meta.url), 'utf8');
  const result = await populateLanternCoast({
    yaml,
    request,
    ownerActor: 'connected-user',
    playerFor: async () => 'connected-user',
    nextEffectId: async () => randomUUID(),
  });
  process.stdout.write(`${JSON.stringify({ kind: 'complete', ...result, calls: step })}\n`);
} catch (error) {
  process.stdout.write(`${JSON.stringify({ kind: 'error', error: String(error) })}\n`);
  process.exitCode = 1;
} finally {
  input.close();
  await lines.return?.();
}
