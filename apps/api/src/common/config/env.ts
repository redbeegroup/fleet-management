import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  MODE: z.enum(['api', 'worker', 'ingest', 'job']).default('api'),
  /** With MODE=job: name of the job to run once, then exit. */
  JOB: z.string().optional(),
  PORT: z.coerce.number().int().default(3000),
  DATABASE_URL: z.string().url(),
  /** DDL connection (migrations). The API uses it only to manage BI logins (S15), see BI_ADMIN_DATABASE_URL. */
  DATABASE_MIGRATION_URL: z.preprocess((v) => (v === '' ? undefined : v), z.string().url().optional()),
  /** Connection that may CREATE/ALTER/DROP ROLE for BI logins; defaults to DATABASE_MIGRATION_URL. Unset: BI logins are off. */
  BI_ADMIN_DATABASE_URL: z.preprocess((v) => (v === '' ? undefined : v), z.string().url().optional()),
  /** Host/port shown to BI users (e.g. a load balancer or a tunnel); defaults to the DATABASE_URL host. */
  BI_DB_HOST: z.string().optional(),
  BI_DB_PORT: z.coerce.number().int().optional(),
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
  /** Fuel card provider API for companies with card sync enabled: none, mock (demo/test) or a generic REST API. */
  FUEL_CARD_API: z.enum(['none', 'mock', 'rest']).default('none'),
  FUEL_CARD_API_URL: z.string().optional(),
  FUEL_CARD_API_KEY: z.string().optional(),

  // SAP S/4HANA link (S19): none = off, mock = demo stand-in, odata = real system (per-company connection)
  SAP_MODE: z.enum(['none', 'mock', 'odata']).default('none'),
  /** Allow http:// SAP URLs (tests / internal networks only). */
  SAP_ALLOW_INSECURE: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),

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
  // Single sign-on (S15). Group providers: the group's Entra tenant and Google Workspace.
  /** Key for client secrets of company-owned providers (any string, 32+ characters recommended). */
  SSO_ENCRYPTION_KEY: z.string().min(16).optional(),
  /** Defaults to APP_URL + /api/auth/sso/callback. */
  SSO_REDIRECT_URL: z.string().url().optional(),
  ENTRA_TENANT_ID: z.string().optional(),
  ENTRA_CLIENT_ID: z.string().optional(),
  ENTRA_CLIENT_SECRET: z.string().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  /** Overridable for tests (fake identity provider). */
  ENTRA_AUTHORITY: z.string().default('https://login.microsoftonline.com'),
  GOOGLE_ISSUER: z.string().default('https://accounts.google.com'),
  /** Deep link the driver app listens on after SSO. */
  MOBILE_SSO_REDIRECT: z.string().default('fmsdriver://sso'),
  /** Expo push service (mobile notifications). */
  PUSH_ENABLED: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),
  EXPO_PUSH_URL: z.string().default('https://exp.host/--/api/v2/push/send'),
  EXPO_ACCESS_TOKEN: z.string().optional(),
  /** Road routing (OSRM osrm-routed and vroom-express); straight lines when unset or down. */
  OSRM_URL: z.preprocess((v) => (v === '' ? undefined : v), z.string().url().optional()),
  VROOM_URL: z.preprocess((v) => (v === '' ? undefined : v), z.string().url().optional()),
  /** Webhooks: allow http:// URLs (testing only). */
  WEBHOOK_ALLOW_INSECURE: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),
  /** Webhooks: allow private / loopback targets (testing or on-prem DMS only). */
  WEBHOOK_ALLOW_PRIVATE: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),

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
