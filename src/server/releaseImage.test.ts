import { afterEach, describe, expect, it } from 'bun:test';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parse } from 'yaml';

const ROOT = resolve(import.meta.dir, '../..');
const IMAGE = 'ghcr.io/example/companion';
const DIGEST_A = `sha256:${'a'.repeat(64)}`;
const DIGEST_B = `sha256:${'b'.repeat(64)}`;
const scratch: string[] = [];
afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'gpc-promotion-'));
  scratch.push(dir);
  const calls = join(dir, 'calls.jsonl');
  const output = join(dir, 'output');
  const state = join(dir, 'registry.json');
  const revision = 'c'.repeat(40);
  const git = join(dir, 'git');
  const docker = join(dir, 'docker');
  writeFileSync(
    git,
    `#!/bin/sh
if [ "$1" = "rev-parse" ] && [ "$2" = "HEAD" ]; then
  printf '%s\\n' "$FAKE_REVISION"
else
  exit 2
fi
`,
  );
  chmodSync(git, 0o755);
  writeFileSync(
    docker,
    `#!/usr/bin/env bun
import { appendFileSync, readFileSync } from 'node:fs';
const args = process.argv.slice(2);
appendFileSync(process.env.FAKE_CALLS, JSON.stringify(args) + '\\n');
const state = JSON.parse(readFileSync(process.env.FAKE_STATE, 'utf8'));
if (args[0] === 'buildx' && args[2] === 'inspect') console.log(JSON.stringify(state.manifest));
else if (args[0] === 'image' && args[1] === 'inspect') console.log(args.at(-1).includes('Labels') ? state.revision : state.platform);
else if (args[0] !== 'pull' && !(args[0] === 'buildx' && args[2] === 'create')) process.exit(1);
`,
  );
  chmodSync(docker, 0o755);
  const env = {
    ...process.env,
    PATH: `${dir}:${process.env.PATH}`,
    IMAGE,
    SRC: 'dev',
    GITHUB_OUTPUT: output,
    FAKE_CALLS: calls,
    FAKE_STATE: state,
    FAKE_REVISION: revision,
  };
  const setRegistry = (overrides: Record<string, unknown> = {}) =>
    writeFileSync(
      state,
      JSON.stringify({
        manifest: {
          digest: DIGEST_A,
          manifests: [
            { platform: { os: 'linux', architecture: 'amd64' } },
            { platform: { os: 'unknown', architecture: 'unknown' } },
          ],
        },
        revision,
        platform: 'linux/amd64',
        ...overrides,
      }),
    );
  setRegistry();
  return {
    setRegistry,
    output: () => readFileSync(output, 'utf8'),
    calls: () =>
      readFileSync(calls, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as string[]),
    run: (action: string, overrides: Record<string, string> = {}) =>
      Bun.spawnSync(['sh', 'scripts/release-image.sh', action], {
        cwd: ROOT,
        env: { ...env, ...overrides },
      }),
  };
}

describe('release image promotion', () => {
  it('promotes the tested digest even after the source tag changes', () => {
    const f = fixture();
    expect(f.run('resolve').exitCode).toBe(0);
    expect(f.output()).toBe(`candidate=${IMAGE}@${DIGEST_A}\n`);
    // The mutable registry tag now points somewhere else during acceptance.
    f.setRegistry({ manifest: { digest: DIGEST_B } });
    expect(f.run('promote', { CANDIDATE: `${IMAGE}@${DIGEST_A}`, VER: '1.2.3' }).exitCode).toBe(0);
    const calls = f.calls();
    expect(
      calls.filter((args) => args.includes('inspect') && args.includes('imagetools')),
    ).toHaveLength(1);
    expect(calls.find((args) => args[0] === 'pull')?.at(-1)).toBe(`${IMAGE}@${DIGEST_A}`);
    const publish = calls.find((args) => args.includes('create'));
    expect(publish?.at(-1)).toBe(`${IMAGE}@${DIGEST_A}`);
    for (const tag of ['v1.2.3', '1.2.3', 'latest', '1.2'])
      expect(publish).toContain(`${IMAGE}:${tag}`);
    expect(publish).toContain('--prefer-index=false');
  });

  it.each(['wrong-commit', '', '<no value>'])(
    'rejects image provenance %s before acceptance',
    (revision) => {
      const f = fixture();
      f.setRegistry({ revision });
      expect(f.run('resolve').exitCode).not.toBe(0);
      expect(f.calls().some((args) => args.includes('create'))).toBe(false);
    },
  );

  it('rejects untested platforms and malformed digests', () => {
    const f = fixture();
    f.setRegistry({
      manifest: {
        digest: DIGEST_A,
        manifests: [
          { platform: { os: 'linux', architecture: 'amd64' } },
          { platform: { os: 'linux', architecture: 'arm64' } },
        ],
      },
    });
    expect(f.run('resolve').exitCode).not.toBe(0);
    f.setRegistry({ manifest: { digest: 'invalid' } });
    expect(f.run('resolve').exitCode).not.toBe(0);
    expect(f.calls().some((args) => args[0] === 'pull')).toBe(false);
  });

  it('keeps prereleases out of stable aliases and rejects mutable promotion refs', () => {
    const f = fixture();
    expect(f.run('promote', { CANDIDATE: `${IMAGE}:dev`, VER: '1.2.3' }).exitCode).not.toBe(0);
    expect(
      f.run('promote', { CANDIDATE: `${IMAGE}@${DIGEST_A}`, VER: '1.2.3-rc.1' }).exitCode,
    ).toBe(0);
    const publish = f.calls().find((args) => args.includes('create'));
    expect(publish).toContain(`${IMAGE}:v1.2.3-rc.1`);
    expect(publish).not.toContain(`${IMAGE}:latest`);
    expect(publish).not.toContain(`${IMAGE}:1.2`);
    expect(f.output()).toContain('prerelease=true');
  });

  it('wires the pinned candidate through migration, acceptance and publication before release', () => {
    const workflow = parse(readFileSync(join(ROOT, '.github/workflows/promote-image.yml'), 'utf8'));
    const steps = workflow.jobs.promote.steps as Array<{
      name?: string;
      id?: string;
      env?: Record<string, string>;
      run?: string;
      uses?: string;
    }>;
    const pin = steps.findIndex((step) => step.id === 'source');
    const start = steps.findIndex(
      (step) => step.name === 'Start source image with an isolated database',
    );
    const gate = steps.findIndex((step) => step.name?.includes('release gate'));
    const tag = steps.findIndex((step) => step.name === 'Create and push git tag');
    const promote = steps.findIndex((step) => step.id === 'retag');
    const release = steps.findIndex((step) => step.uses?.startsWith('softprops/action-gh-release'));
    expect(pin).toBeGreaterThan(-1);
    expect(start).toBeGreaterThan(pin);
    expect(gate).toBeGreaterThan(start);
    expect(tag).toBeGreaterThan(gate);
    expect(promote).toBeGreaterThan(gate);
    expect(release).toBeGreaterThan(promote);
    expect(steps[start]?.env?.CANDIDATE).toBe('${{ steps.source.outputs.candidate }}');
    expect(steps[promote]?.env?.CANDIDATE).toBe('${{ steps.source.outputs.candidate }}');
    expect(steps[start]?.run?.match(/"\$CANDIDATE"/g)).toHaveLength(2);
    expect(steps[start]?.run).not.toContain('$SRC');
    expect(steps[promote]?.run).toBe('sh scripts/release-image.sh promote');
  });
});
