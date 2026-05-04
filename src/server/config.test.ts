import { describe, expect, it } from 'bun:test';
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
});
