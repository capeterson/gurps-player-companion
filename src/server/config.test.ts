import { afterEach, describe, expect, it } from 'bun:test';
import { loadConfig, resetConfigCache } from './config.ts';

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

  it('requires a canonical HTTPS origin in production', () => {
    for (const value of [
      undefined,
      'http://gpc.example',
      'https://gpc.example/path',
      'https://gpc.example?tenant=1',
      'https://gpc.example/#fragment',
      'https://user:secret@gpc.example',
    ]) {
      resetConfigCache();
      expect(() =>
        loadConfig({ ...goodEnv, ENVIRONMENT: 'production', APP_BASE_URL: value }),
      ).toThrow();
    }
    resetConfigCache();
    expect(
      loadConfig({ ...goodEnv, ENVIRONMENT: 'production', APP_BASE_URL: 'https://gpc.example' })
        .appBaseUrl,
    ).toBe('https://gpc.example');
  });

  it('permits development HTTP origins but rejects ambiguous resource URLs', () => {
    resetConfigCache();
    expect(loadConfig({ ...goodEnv, APP_BASE_URL: 'http://localhost:3001' }).appBaseUrl).toBe(
      'http://localhost:3001',
    );
    for (const value of [
      'http://localhost:3001/base',
      'http://localhost:3001?x=1',
      'ftp://localhost',
    ]) {
      resetConfigCache();
      expect(() => loadConfig({ ...goodEnv, APP_BASE_URL: value })).toThrow();
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
