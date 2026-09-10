import { type AppConfig, resetConfigCache } from './config.ts';

const defaultDatabaseUrl = 'postgres://gurps:gurps@localhost:5432/gurps';

// Compose injects DATABASE_URL with the `db` hostname; host and CI runs use this fallback.
export const integrationTestConfig: AppConfig = {
  environment: 'test',
  port: 0,
  host: '127.0.0.1',
  databaseUrl: process.env.DATABASE_URL ?? defaultDatabaseUrl,
  jwtSecret: 'test-secret-which-is-deliberately-very-long-and-not-a-placeholder',
  jwtAccessTtlMinutes: 15,
  jwtRefreshTtlDays: 14,
  apiKeyPepper: 'test-secret-which-is-deliberately-very-long-and-not-a-placeholder',
  corsOrigins: [],
  resendApiKey: undefined,
  resendFromEmail: undefined,
  appBaseUrl: undefined,
  trustProxy: false,
  authRateLimitWindowSeconds: 600,
  // Most route suites share a synthetic transport and create many fixtures.
  // Limiter-specific tests override these budgets with production-sized limits.
  authRateLimitLoginMax: 10_000,
  authRateLimitRegisterMax: 10_000,
  authRateLimitResetMax: 10_000,
  authRateLimitChallengeMax: 10_000,
};

export function configureIntegrationTestEnvironment(): void {
  process.env.DATABASE_URL = integrationTestConfig.databaseUrl;
  process.env.JWT_SECRET = integrationTestConfig.jwtSecret;
  process.env.ENVIRONMENT = integrationTestConfig.environment;
  process.env.TRUST_PROXY = String(integrationTestConfig.trustProxy);
  process.env.AUTH_RATE_LIMIT_LOGIN_MAX = String(integrationTestConfig.authRateLimitLoginMax);
  process.env.AUTH_RATE_LIMIT_REGISTER_MAX = String(integrationTestConfig.authRateLimitRegisterMax);
  process.env.AUTH_RATE_LIMIT_RESET_MAX = String(integrationTestConfig.authRateLimitResetMax);
  process.env.AUTH_RATE_LIMIT_CHALLENGE_MAX = String(
    integrationTestConfig.authRateLimitChallengeMax,
  );
  resetConfigCache();
}
