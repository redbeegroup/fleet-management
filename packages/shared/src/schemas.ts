import { z } from 'zod';
import { DocumentType, OwnershipType, VehicleClass, VehicleStatus } from './enums';

const optionalDate = z.coerce.date().optional().nullable();

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const createVehicleSchema = z.object({
  plateNumber: z.string().trim().min(1).max(32),
  vin: z.string().trim().max(32).optional().nullable(),
  make: z.string().trim().min(1).max(64),
  model: z.string().trim().min(1).max(64),
  year: z.number().int().min(1950).max(2100).optional().nullable(),
  vehicleClass: z.nativeEnum(VehicleClass),
  ownership: z.nativeEnum(OwnershipType).default('OWNED'),
  fuelType: z.string().max(32).optional().nullable(),
  capacityKg: z.number().nonnegative().optional().nullable(),
  capacityM3: z.number().nonnegative().optional().nullable(),
  odometerKm: z.number().nonnegative().default(0),
  branchId: z.string().uuid().optional().nullable(),
  departmentId: z.string().uuid().optional().nullable(),
  gpsDeviceId: z.string().max(64).optional().nullable(),
  speedLimitKmh: z.number().int().min(10).max(200).optional().nullable(),
  acquiredAt: optionalDate,
  notes: z.string().max(2000).optional().nullable(),
});
export type CreateVehicleInput = z.infer<typeof createVehicleSchema>;

export const updateVehicleSchema = createVehicleSchema.partial();
export type UpdateVehicleInput = z.infer<typeof updateVehicleSchema>;

export const changeVehicleStatusSchema = z.object({
  status: z.nativeEnum(VehicleStatus),
  reason: z.string().max(500).optional(),
});
export type ChangeVehicleStatusInput = z.infer<typeof changeVehicleStatusSchema>;

export const assignVehicleSchema = z
  .object({
    driverId: z.string().uuid().optional().nullable(),
    branchId: z.string().uuid().optional().nullable(),
    departmentId: z.string().uuid().optional().nullable(),
    note: z.string().max(500).optional(),
  })
  .refine((v) => v.driverId || v.branchId || v.departmentId, {
    message: 'At least one of driverId, branchId or departmentId is required',
  });
export type AssignVehicleInput = z.infer<typeof assignVehicleSchema>;

export const createVehicleDocumentSchema = z.object({
  type: z.nativeEnum(DocumentType),
  number: z.string().max(64).optional().nullable(),
  issuer: z.string().max(128).optional().nullable(),
  issuedAt: optionalDate,
  expiresAt: optionalDate,
  amount: z.number().nonnegative().optional().nullable(),
  fileId: z.string().uuid().optional().nullable(),
});
export type CreateVehicleDocumentInput = z.infer<typeof createVehicleDocumentSchema>;

export const createBranchSchema = z.object({
  code: z.string().trim().min(1).max(16),
  name: z.string().trim().min(1).max(128),
  address: z.string().max(500).optional().nullable(),
  latitude: z.number().min(-90).max(90).optional().nullable(),
  longitude: z.number().min(-180).max(180).optional().nullable(),
});
export type CreateBranchInput = z.infer<typeof createBranchSchema>;

export const createDriverSchema = z.object({
  employeeNo: z.string().trim().min(1).max(32),
  fullName: z.string().trim().min(1).max(128),
  phone: z.string().max(32).optional().nullable(),
  branchId: z.string().uuid().optional().nullable(),
  licenseNumber: z.string().max(64).optional().nullable(),
  licenseClass: z.string().max(16).optional().nullable(),
  licenseExpiresAt: optionalDate,
});
export type CreateDriverInput = z.infer<typeof createDriverSchema>;

export const updateVehicleDocumentSchema = createVehicleDocumentSchema.partial();
export type UpdateVehicleDocumentInput = z.infer<typeof updateVehicleDocumentSchema>;

export const updateDriverSchema = z.object({
  fullName: z.string().trim().min(1).max(128).optional(),
  phone: z.string().max(32).optional().nullable(),
  branchId: z.string().uuid().optional().nullable(),
  active: z.boolean().optional(),
  userId: z.string().uuid().optional().nullable(),
});
export type UpdateDriverInput = z.infer<typeof updateDriverSchema>;

export const createDriverLicenseSchema = z.object({
  number: z.string().trim().min(1).max(64),
  licenseClass: z.string().trim().min(1).max(16),
  issuedAt: optionalDate,
  expiresAt: optionalDate,
  fileId: z.string().uuid().optional().nullable(),
});
export type CreateDriverLicenseInput = z.infer<typeof createDriverLicenseSchema>;

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  search: z.string().max(100).optional(),
});
export type PaginationInput = z.infer<typeof paginationSchema>;

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

// ---------------------------------------------------------------------------
// Telematics (Sprint 3)
// ---------------------------------------------------------------------------

const lngLat = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);

export const geofenceSchema = z
  .object({
    name: z.string().trim().min(1).max(128),
    category: z.enum(['BRANCH', 'WAREHOUSE', 'CUSTOMER', 'SITE', 'RESTRICTED']).default('SITE'),
    shape: z.enum(['CIRCLE', 'POLYGON']),
    centerLat: z.number().min(-90).max(90).optional().nullable(),
    centerLng: z.number().min(-180).max(180).optional().nullable(),
    radiusM: z.number().min(10).max(100_000).optional().nullable(),
    /** [[lng, lat], ...] — at least 3 distinct vertices, not closed */
    polygon: z.array(lngLat).min(3).max(500).optional().nullable(),
    alertOnEnter: z.boolean().default(false),
    alertOnExit: z.boolean().default(false),
    active: z.boolean().default(true),
  })
  .superRefine((g, ctx) => {
    if (g.shape === 'CIRCLE' && (g.centerLat == null || g.centerLng == null || g.radiusM == null)) {
      ctx.addIssue({ code: 'custom', path: ['radiusM'], message: 'CIRCLE requires centerLat, centerLng and radiusM' });
    }
    if (g.shape === 'POLYGON' && !g.polygon) {
      ctx.addIssue({ code: 'custom', path: ['polygon'], message: 'POLYGON requires polygon vertices' });
    }
  });
export type GeofenceInput = z.infer<typeof geofenceSchema>;

export const telematicsSettingsSchema = z.object({
  /** Default overspeed limit; vehicles may override with speedLimitKmh. */
  speedLimitKmh: z.number().int().min(10).max(200).default(80),
  /** Speed must drop this far below the limit to end an overspeed episode. */
  overspeedHysteresisKmh: z.number().int().min(0).max(30).default(5),
  /** Engine on and (almost) stationary for this long = idling. */
  idleMinutes: z.number().int().min(1).max(240).default(10),
  /** No position for this long = GPS offline. */
  offlineMinutes: z.number().int().min(5).max(1440).default(30),
});
export type TelematicsSettings = z.infer<typeof telematicsSettingsSchema>;

export const companySettingsSchema = z.object({
  telematics: telematicsSettingsSchema.default({}),
});
export type CompanySettings = z.infer<typeof companySettingsSchema>;

export const updateCompanySettingsSchema = z.object({
  telematics: telematicsSettingsSchema.partial().optional(),
});
export type UpdateCompanySettingsInput = z.infer<typeof updateCompanySettingsSchema>;
