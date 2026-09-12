import { generateMcpSnapshot } from './snapshot.ts';

process.stdout.write(`${JSON.stringify(generateMcpSnapshot(), null, 2)}\n`);
