import { z } from 'zod';

const placeholderSecrets = new Set([
  'replace-me-with-output-of-openssl-rand-hex-32',
  'change-me',
  'changeme',
  'secret',
  'placeholder',
]);

const envSchema = z.object({
  ENVIRONMENT: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().url().or(z.string().startsWith('postgres://')),
  JWT_SECRET: z
    .string()
    .min(32, 'JWT_SECRET must be at least 32 characters')
    .refine((value) => !placeholderSecrets.has(value), 'JWT_SECRET is a placeholder'),
  JWT_ACCESS_TTL_MINUTES: z.coerce.number().int().positive().default(15),
  JWT_REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(14),
  API_KEY_PEPPER: z.string().min(16).optional(),
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM_EMAIL: z.string().email().optional(),
  APP_BASE_URL: z.string().url().optional(),
  TRUST_PROXY: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  AUTH_RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().min(1).max(86_400).default(600),
  AUTH_RATE_LIMIT_LOGIN_MAX: z.coerce.number().int().positive().default(10),
  AUTH_RATE_LIMIT_REGISTER_MAX: z.coerce.number().int().positive().default(5),
  AUTH_RATE_LIMIT_RESET_MAX: z.coerce.number().int().positive().default(3),
  AUTH_RATE_LIMIT_CHALLENGE_MAX: z.coerce.number().int().positive().default(10),
  CORS_ORIGINS: z
    .string()
    .default('[]')
    .transform((raw, ctx) => {
      try {
        const parsed: unknown = JSON.parse(raw);
        if (
          !Array.isArray(parsed) ||
          parsed.some((value): value is string => typeof value !== 'string')
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'CORS_ORIGINS must be a JSON array of strings',
          });
          return z.NEVER;
        }
        return parsed as string[];
      } catch {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'CORS_ORIGINS must be valid JSON',
        });
        return z.NEVER;
      }
    }),
});

export type AppConfig = {
  environment: 'development' | 'test' | 'production';
  port: number;
  host: string;
  databaseUrl: string;
  jwtSecret: string;
  jwtAccessTtlMinutes: number;
  jwtRefreshTtlDays: number;
  apiKeyPepper: string;
  corsOrigins: string[];
  resendApiKey: string | undefined;
  resendFromEmail: string | undefined;
  appBaseUrl: string | undefined;
  trustProxy: boolean;
  authRateLimitWindowSeconds: number;
  authRateLimitLoginMax: number;
  authRateLimitRegisterMax: number;
  authRateLimitResetMax: number;
  authRateLimitChallengeMax: number;
};

let cached: AppConfig | undefined;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  if (cached) return cached;
  const parsed = envSchema.parse({
    ENVIRONMENT: env.ENVIRONMENT,
    PORT: env.PORT,
    HOST: env.HOST,
    DATABASE_URL: env.DATABASE_URL,
    JWT_SECRET: env.JWT_SECRET,
    JWT_ACCESS_TTL_MINUTES: env.JWT_ACCESS_TTL_MINUTES,
    JWT_REFRESH_TTL_DAYS: env.JWT_REFRESH_TTL_DAYS,
    API_KEY_PEPPER: env.API_KEY_PEPPER,
    CORS_ORIGINS: env.CORS_ORIGINS,
    RESEND_API_KEY: env.RESEND_API_KEY,
    RESEND_FROM_EMAIL: env.RESEND_FROM_EMAIL,
    APP_BASE_URL: env.APP_BASE_URL,
    TRUST_PROXY: env.TRUST_PROXY,
    AUTH_RATE_LIMIT_WINDOW_SECONDS: env.AUTH_RATE_LIMIT_WINDOW_SECONDS,
    AUTH_RATE_LIMIT_LOGIN_MAX: env.AUTH_RATE_LIMIT_LOGIN_MAX,
    AUTH_RATE_LIMIT_REGISTER_MAX: env.AUTH_RATE_LIMIT_REGISTER_MAX,
    AUTH_RATE_LIMIT_RESET_MAX: env.AUTH_RATE_LIMIT_RESET_MAX,
    AUTH_RATE_LIMIT_CHALLENGE_MAX: env.AUTH_RATE_LIMIT_CHALLENGE_MAX,
  });

  cached = {
    environment: parsed.ENVIRONMENT,
    port: parsed.PORT,
    host: parsed.HOST,
    databaseUrl: parsed.DATABASE_URL,
    jwtSecret: parsed.JWT_SECRET,
    jwtAccessTtlMinutes: parsed.JWT_ACCESS_TTL_MINUTES,
    jwtRefreshTtlDays: parsed.JWT_REFRESH_TTL_DAYS,
    apiKeyPepper: parsed.API_KEY_PEPPER ?? parsed.JWT_SECRET,
    corsOrigins: parsed.CORS_ORIGINS,
    resendApiKey: parsed.RESEND_API_KEY,
    resendFromEmail: parsed.RESEND_FROM_EMAIL,
    appBaseUrl: parsed.APP_BASE_URL,
    trustProxy: parsed.TRUST_PROXY,
    authRateLimitWindowSeconds: parsed.AUTH_RATE_LIMIT_WINDOW_SECONDS,
    authRateLimitLoginMax: parsed.AUTH_RATE_LIMIT_LOGIN_MAX,
    authRateLimitRegisterMax: parsed.AUTH_RATE_LIMIT_REGISTER_MAX,
    authRateLimitResetMax: parsed.AUTH_RATE_LIMIT_RESET_MAX,
    authRateLimitChallengeMax: parsed.AUTH_RATE_LIMIT_CHALLENGE_MAX,
  };
  return cached;
}

export function resetConfigCache(): void {
  cached = undefined;
}
