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
  };
  return cached;
}

export function resetConfigCache(): void {
  cached = undefined;
}
