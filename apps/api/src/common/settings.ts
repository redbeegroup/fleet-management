import { CompanySettings, companySettingsSchema } from '@fms/shared';

/** Parses stored company settings, filling defaults for anything missing or invalid. */
export function parseCompanySettings(raw: unknown): CompanySettings {
  const parsed = companySettingsSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : companySettingsSchema.parse({});
}
