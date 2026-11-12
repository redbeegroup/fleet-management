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
  tankCapacityL: z.number().positive().max(2000).optional().nullable(),
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
  // Declared lazily: dispatchSettingsSchema is defined further down this file.
  dispatch: z.lazy(() => dispatchSettingsSchema).default({}),
  maintenance: z.lazy(() => maintenanceSettingsSchema).default({}),
});
export type CompanySettings = z.infer<typeof companySettingsSchema>;

export const updateCompanySettingsSchema = z.object({
  telematics: telematicsSettingsSchema.partial().optional(),
  dispatch: z.lazy(() => dispatchSettingsSchema.partial()).optional(),
  maintenance: z.lazy(() => maintenanceSettingsSchema.partial()).optional(),
});
export type UpdateCompanySettingsInput = z.infer<typeof updateCompanySettingsSchema>;

// ---------------------------------------------------------------------------
// Dispatch (Sprint 4)
// ---------------------------------------------------------------------------

const place = {
  originName: z.string().trim().min(1).max(200),
  originLat: z.number().min(-90).max(90).optional().nullable(),
  originLng: z.number().min(-180).max(180).optional().nullable(),
  destinationName: z.string().trim().min(1).max(200),
  destinationLat: z.number().min(-90).max(90).optional().nullable(),
  destinationLng: z.number().min(-180).max(180).optional().nullable(),
};

const window = z
  .object({ plannedStart: z.coerce.date(), plannedEnd: z.coerce.date() })
  .refine((w) => w.plannedEnd > w.plannedStart, { path: ['plannedEnd'], message: 'plannedEnd must be after plannedStart' })
  .refine((w) => w.plannedEnd.getTime() - w.plannedStart.getTime() <= 14 * 86_400_000, {
    path: ['plannedEnd'],
    message: 'A trip can be planned for at most 14 days',
  });

export const createTripSchema = z
  .object({
    ...place,
    plannedStart: z.coerce.date(),
    plannedEnd: z.coerce.date(),
    branchId: z.string().uuid().optional().nullable(),
    vehicleId: z.string().uuid().optional().nullable(),
    driverId: z.string().uuid().optional().nullable(),
    purpose: z.string().max(200).optional().nullable(),
    cargoDescription: z.string().max(500).optional().nullable(),
    cargoWeightKg: z.number().nonnegative().optional().nullable(),
    notes: z.string().max(2000).optional().nullable(),
  })
  .and(window);
export type CreateTripInput = z.infer<typeof createTripSchema>;

export const updateTripSchema = z.object({
  ...Object.fromEntries(Object.entries(place).map(([k, v]) => [k, v.optional()])),
  plannedStart: z.coerce.date().optional(),
  plannedEnd: z.coerce.date().optional(),
  purpose: z.string().max(200).optional().nullable(),
  cargoDescription: z.string().max(500).optional().nullable(),
  cargoWeightKg: z.number().nonnegative().optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
}) as z.ZodType<Partial<Omit<CreateTripInput, 'vehicleId' | 'driverId' | 'branchId'>>>;
export type UpdateTripInput = z.infer<typeof updateTripSchema>;

export const assignTripSchema = z.object({
  vehicleId: z.string().uuid(),
  driverId: z.string().uuid(),
});
export type AssignTripInput = z.infer<typeof assignTripSchema>;

export const startTripSchema = z.object({
  at: z.coerce.date().optional(),
  odometerKm: z.number().nonnegative().optional(),
});
export type StartTripInput = z.infer<typeof startTripSchema>;

export const completeTripSchema = z.object({
  at: z.coerce.date().optional(),
  odometerKm: z.number().nonnegative().optional(),
  notes: z.string().max(2000).optional(),
});
export type CompleteTripInput = z.infer<typeof completeTripSchema>;

export const cancelTripSchema = z.object({ reason: z.string().trim().min(3).max(500) });
export type CancelTripInput = z.infer<typeof cancelTripSchema>;

export const availabilityQuerySchema = z
  .object({ from: z.coerce.date(), to: z.coerce.date(), excludeTripId: z.string().uuid().optional() })
  .refine((w) => w.to > w.from, { path: ['to'], message: '`to` must be after `from`' });
export type AvailabilityQuery = z.infer<typeof availabilityQuerySchema>;

/**
 * Licence classes allowed per vehicle class (configurable per company).
 * An empty list means any valid licence is accepted.
 */
export const dispatchSettingsSchema = z.object({
  enforceLicenceClass: z.boolean().default(true),
  licenceRules: z
    .record(z.string(), z.array(z.string().trim().toUpperCase()))
    .default({ TRUCK: ['C', 'D', 'E'], BUS: ['D', 'E'], TRAILER: ['E'], MOTORCYCLE: ['A'] }),
});
export type DispatchSettings = z.infer<typeof dispatchSettingsSchema>;

// ---------------------------------------------------------------------------
// Fuel & maintenance (Sprint 5)
// ---------------------------------------------------------------------------

export const createFuelRecordSchema = z
  .object({
    vehicleId: z.string().uuid(),
    driverId: z.string().uuid().optional().nullable(),
    filledAt: z.coerce.date(),
    odometerKm: z.number().nonnegative(),
    litres: z.number().positive().max(2000),
    unitPrice: z.number().nonnegative().optional().nullable(),
    totalCost: z.number().nonnegative().optional().nullable(),
    fuelType: z.string().max(32).optional().nullable(),
    station: z.string().max(200).optional().nullable(),
    fullTank: z.boolean().default(true),
    paymentMethod: z.enum(['CASH', 'FUEL_CARD', 'CREDIT', 'OTHER']).optional().nullable(),
    receiptFileId: z.string().uuid().optional().nullable(),
    notes: z.string().max(1000).optional().nullable(),
  })
  .refine((r) => r.unitPrice != null || r.totalCost != null, { path: ['totalCost'], message: 'Provide unitPrice or totalCost' })
  .refine((r) => r.filledAt.getTime() <= Date.now() + 5 * 60_000, { path: ['filledAt'], message: 'filledAt cannot be in the future' });
export type CreateFuelRecordInput = z.infer<typeof createFuelRecordSchema>;

export const maintenancePlanSchema = z
  .object({
    vehicleId: z.string().uuid(),
    name: z.string().trim().min(1).max(128),
    intervalKm: z.number().int().min(100).max(1_000_000).optional().nullable(),
    intervalDays: z.number().int().min(1).max(3650).optional().nullable(),
    lastDoneAt: z.coerce.date().optional().nullable(),
    lastDoneOdometerKm: z.number().nonnegative().optional().nullable(),
    active: z.boolean().default(true),
  })
  .refine((p) => p.intervalKm || p.intervalDays, { path: ['intervalKm'], message: 'Set intervalKm and/or intervalDays' });
export type MaintenancePlanInput = z.infer<typeof maintenancePlanSchema>;

/** Create the same plan for many vehicles at once (e.g. all trucks). */
export const bulkMaintenancePlanSchema = z.object({
  vehicleIds: z.array(z.string().uuid()).min(1).max(500),
  name: z.string().trim().min(1).max(128),
  intervalKm: z.number().int().min(100).max(1_000_000).optional().nullable(),
  intervalDays: z.number().int().min(1).max(3650).optional().nullable(),
});
export type BulkMaintenancePlanInput = z.infer<typeof bulkMaintenancePlanSchema>;

export const RepairSeverity = { LOW: 'LOW', MEDIUM: 'MEDIUM', HIGH: 'HIGH', CRITICAL: 'CRITICAL' } as const;

export const createRepairRequestSchema = z.object({
  vehicleId: z.string().uuid(),
  description: z.string().trim().min(5).max(2000),
  severity: z.nativeEnum(RepairSeverity).default('MEDIUM'),
  odometerKm: z.number().nonnegative().optional().nullable(),
  photoFileId: z.string().uuid().optional().nullable(),
});
export type CreateRepairRequestInput = z.infer<typeof createRepairRequestSchema>;

export const WorkOrderType = { PREVENTIVE: 'PREVENTIVE', CORRECTIVE: 'CORRECTIVE', ACCIDENT: 'ACCIDENT', INSPECTION: 'INSPECTION' } as const;
export const WorkOrderStatus = { OPEN: 'OPEN', IN_PROGRESS: 'IN_PROGRESS', COMPLETED: 'COMPLETED', CANCELLED: 'CANCELLED' } as const;

export const createWorkOrderSchema = z.object({
  vehicleId: z.string().uuid(),
  type: z.nativeEnum(WorkOrderType),
  title: z.string().trim().min(1).max(200),
  description: z.string().max(4000).optional().nullable(),
  priority: z.nativeEnum(RepairSeverity).default('MEDIUM'),
  workshop: z.string().max(200).optional().nullable(),
  assignedTo: z.string().max(200).optional().nullable(),
  offRoad: z.boolean().default(true),
  odometerKm: z.number().nonnegative().optional().nullable(),
  planId: z.string().uuid().optional().nullable(),
  repairRequestIds: z.array(z.string().uuid()).max(50).optional(),
});
export type CreateWorkOrderInput = z.infer<typeof createWorkOrderSchema>;

export const workOrderLineSchema = z.object({
  kind: z.enum(['LABOUR', 'PART', 'EXTERNAL', 'OTHER']),
  description: z.string().trim().min(1).max(300),
  quantity: z.number().positive().max(100_000),
  unitCost: z.number().nonnegative(),
});
export type WorkOrderLineInput = z.infer<typeof workOrderLineSchema>;

export const completeWorkOrderSchema = z.object({
  resolution: z.string().trim().min(3).max(4000),
  completedAt: z.coerce.date().optional(),
  odometerKm: z.number().nonnegative().optional(),
});
export type CompleteWorkOrderInput = z.infer<typeof completeWorkOrderSchema>;

export const maintenanceSettingsSchema = z.object({
  /** A plan is "due soon" this many km / days before it is due. */
  dueSoonKm: z.number().int().min(0).max(20_000).default(500),
  dueSoonDays: z.number().int().min(0).max(90).default(7),
  /** Fuel efficiency below this fraction of the vehicle median is flagged. */
  lowEfficiencyRatio: z.number().min(0.1).max(1).default(0.7),
});
export type MaintenanceSettings = z.infer<typeof maintenanceSettingsSchema>;
