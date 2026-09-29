import { afterEach, describe, expect, it } from 'bun:test';
import { appUrl, loadConfig, resetConfigCache } from './config.ts';

const goodEnv = {
  ENVIRONMENT: 'test',
  PORT: '3000',
  HOST: '0.0.0.0',
  DATABASE_URL: 'postgres://gurps:gurps@localhost:5432/gurps',
  JWT_SECRET: 'test-secret-which-is-deliberately-very-long-and-not-a-placeholder',
  JWT_ACCESS_TTL_MINUTES: '15',
  JWT_REFRESH_TTL_DAYS: '14',
  CORS_ORIGINS: '["http://localhost:5173"]',
} satisfies NodeJS.ProcessEnv;

describe('loadConfig', () => {
  afterEach(resetConfigCache);
  it('defaults proxy trust on only in production and respects explicit overrides', () => {
    for (const environment of ['development', 'test', 'production']) {
      for (const override of [undefined, 'true', 'false']) {
        resetConfigCache();
        const cfg = loadConfig({
          ...goodEnv,
          ENVIRONMENT: environment,
          APP_HOSTNAME: 'gpc.example',
          TRUST_PROXY: override,
        });
        expect(cfg.trustProxy).toBe(
          override === undefined ? environment === 'production' : override === 'true',
        );
      }
    }
  });
  it('parses a valid environment', () => {
    resetConfigCache();
    const cfg = loadConfig({ ...goodEnv });
    expect(cfg.port).toBe(3000);
    expect(cfg.environment).toBe('test');
    expect(cfg.corsOrigins).toEqual(['http://localhost:5173']);
    expect(cfg.apiKeyPepper).toBe(cfg.jwtSecret);
  });

  it('rejects placeholder JWT_SECRET', () => {
    resetConfigCache();
    expect(() =>
      loadConfig({ ...goodEnv, JWT_SECRET: 'replace-me-with-output-of-openssl-rand-hex-32' }),
    ).toThrow();
  });

  it('rejects short JWT_SECRET', () => {
    resetConfigCache();
    expect(() => loadConfig({ ...goodEnv, JWT_SECRET: 'short' })).toThrow();
  });

  it('uses API_KEY_PEPPER when provided', () => {
    resetConfigCache();
    const cfg = loadConfig({ ...goodEnv, API_KEY_PEPPER: 'pepper-pepper-pepper-pepper' });
    expect(cfg.apiKeyPepper).toBe('pepper-pepper-pepper-pepper');
  });

  it('rejects malformed CORS_ORIGINS JSON', () => {
    resetConfigCache();
    expect(() => loadConfig({ ...goodEnv, CORS_ORIGINS: 'not json' })).toThrow();
  });

  it('requires APP_HOSTNAME in production and ignores the former URL setting', () => {
    expect(() => loadConfig({ ...goodEnv, ENVIRONMENT: 'production' })).toThrow(
      'APP_HOSTNAME is required in production',
    );
    expect(() =>
      loadConfig({ ...goodEnv, ENVIRONMENT: 'production', APP_BASE_URL: 'https://gpc.example' }),
    ).toThrow('APP_HOSTNAME is required in production');
  });

  it('rejects schemes, ports, URL components, and malformed hostnames in every environment', () => {
    for (const environment of ['development', 'test', 'production']) {
      for (const value of [
        '',
        'http://gpc.example',
        'https://gpc.example',
        'gpc.example:443',
        'localhost:3001',
        'gpc.example/path',
        'gpc.example?tenant=1',
        'gpc.example#fragment',
        'user:secret@gpc.example',
        ' gpc.example',
        'gpc.example ',
        'gpc.example\\path',
        'gpc%2eexample',
        'gpc..example',
        '-gpc.example',
        'gpc-.example',
        'gpc_example',
        '127.1',
        '999.999.999.999',
        '[::1]:3001',
        `${'a'.repeat(64)}.example`,
        `${'a'.repeat(63)}.${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(63)}`,
      ]) {
        resetConfigCache();
        expect(() =>
          loadConfig({ ...goodEnv, ENVIRONMENT: environment, APP_HOSTNAME: value }),
        ).toThrow();
      }
    }
  });

  it('derives production HTTPS without including the internal listening port', () => {
    const cfg = loadConfig({
      ...goodEnv,
      ENVIRONMENT: 'production',
      APP_HOSTNAME: 'GPC.Example',
      PORT: '3030',
    });
    expect(cfg.appHostname).toBe('gpc.example');
    expect(appUrl(cfg)).toBe('https://gpc.example');
  });

  it('derives local HTTP using PORT, including worktree ports and IPv6', () => {
    for (const environment of ['development', 'test']) {
      for (const [hostname, port, origin] of [
        ['localhost', '3001', 'http://localhost:3001'],
        ['localhost', '20323', 'http://localhost:20323'],
        ['dev.gpc.example', '65535', 'http://dev.gpc.example:65535'],
        ['127.0.0.1', '80', 'http://127.0.0.1'],
        ['[::1]', '3001', 'http://[::1]:3001'],
      ] as const) {
        resetConfigCache();
        const cfg = loadConfig({
          ...goodEnv,
          ENVIRONMENT: environment,
          APP_HOSTNAME: hostname,
          PORT: port,
        });
        expect(appUrl(cfg)).toBe(origin);
      }
      resetConfigCache();
      expect(appUrl(loadConfig({ ...goodEnv, ENVIRONMENT: environment }))).toBe(
        'http://localhost:3000',
      );
    }
  });

  it('allows exact HTTPS and loopback HTTP callbacks and rejects unsafe registrations', () => {
    const client = (redirectUri: string) => ({
      clientId: 'review',
      name: 'Review',
      redirectUris: [redirectUri],
      scopes: ['gpc:read'],
    });
    for (const uri of [
      'https://agent.example/callback',
      'http://127.0.0.1:49152/callback',
      'http://[::1]:49152/callback',
    ]) {
      resetConfigCache();
      expect(
        loadConfig({ ...goodEnv, OAUTH_CLIENTS: JSON.stringify([client(uri)]) }).oauthClients,
      ).toHaveLength(1);
    }
    for (const uri of [
      'http://agent.example/callback',
      'javascript:alert(1)',
      'ftp://localhost/callback',
      'https://agent.example/#fragment',
      'https://user:secret@agent.example',
    ]) {
      resetConfigCache();
      expect(() =>
        loadConfig({ ...goodEnv, OAUTH_CLIENTS: JSON.stringify([client(uri)]) }),
      ).toThrow();
    }
    resetConfigCache();
    expect(() =>
      loadConfig({
        ...goodEnv,
        OAUTH_CLIENTS: JSON.stringify([client('https://a.example'), client('https://b.example')]),
      }),
    ).toThrow();
  });
});
