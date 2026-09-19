import { readFile } from 'node:fs/promises';
import { generateMcpSnapshot } from './snapshot.ts';

const path = 'docs/mcp-tools.json';
const actual = `${JSON.stringify(generateMcpSnapshot(), null, 2)}\n`;
const expected = await readFile(path, 'utf8').catch(() => '');
if (actual !== expected) {
  console.error(`MCP catalog drift detected: ${path} is stale. Run \`bun run mcp:emit\`.`);
  process.exit(1);
}
console.log(`MCP catalog: ${path} is in sync.`);
