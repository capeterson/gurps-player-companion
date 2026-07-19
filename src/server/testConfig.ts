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
};

export function configureIntegrationTestEnvironment(): void {
  process.env.DATABASE_URL = integrationTestConfig.databaseUrl;
  process.env.JWT_SECRET = integrationTestConfig.jwtSecret;
  process.env.ENVIRONMENT = integrationTestConfig.environment;
  resetConfigCache();
}
