import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  MODE: z.enum(['api', 'worker', 'ingest']).default('api'),
  PORT: z.coerce.number().int().default(3000),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  JWT_ACCESS_SECRET: z.string().min(16),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(14),
  CORS_ORIGINS: z.string().default('http://localhost:5173,http://localhost:8080'),
  SWAGGER_ENABLED: z
    .string()
    .default('true')
    .transform((v) => v === 'true'),
  DOC_EXPIRY_ALERT_DAYS: z.coerce.number().int().positive().default(30),
  WATCHTOWER_BASE_URL: z.string().optional(),
  WATCHTOWER_API_KEY: z.string().optional(),
  WATCHTOWER_POLL_SECONDS: z.coerce.number().int().positive().default(30),
  TELEMATICS_PROVIDER: z.enum(['watchtower', 'mock']).default('mock'),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}

export function env(): Env {
  if (!cached) cached = loadEnv();
  return cached;
}

/** Test helper. */
export function resetEnvCache(): void {
  cached = undefined;
}
