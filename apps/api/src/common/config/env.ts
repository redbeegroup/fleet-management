import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  MODE: z.enum(['api', 'worker', 'ingest', 'job']).default('api'),
  /** With MODE=job: name of the job to run once, then exit. */
  JOB: z.string().optional(),
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

  // File storage
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  STORAGE_LOCAL_DIR: z.string().default('./.data/files'),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().default('fms'),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: z
    .string()
    .default('true')
    .transform((v) => v === 'true'),
  FILE_MAX_MB: z.coerce.number().positive().default(20),

  // Notifications
  SMTP_URL: z.string().optional(),
  MAIL_FROM: z.string().default('FMS <no-reply@fms.local>'),
  APP_URL: z.string().default('http://localhost:8080'),
  /** Expo push service (mobile notifications). */
  PUSH_ENABLED: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),
  EXPO_PUSH_URL: z.string().default('https://exp.host/--/api/v2/push/send'),
  EXPO_ACCESS_TOKEN: z.string().optional(),

  // Observability
  LOG_FORMAT: z.enum(['text', 'json']).default('text'),
  LOG_LEVEL: z.enum(['error', 'warn', 'log', 'debug', 'verbose']).default('log'),
  /** Port for /metrics in worker/ingest processes (the API serves /metrics on its own port). */
  METRICS_PORT: z.coerce.number().int().optional(),
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
