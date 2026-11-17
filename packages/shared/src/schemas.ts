import { z } from 'zod';
import { DocumentType, OwnershipType, VehicleClass, VehicleStatus } from './enums';
import { DEFAULT_LICENCE_RULES, normalizeLicenceClass } from './licences';

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
  capacityCases: z.number().int().nonnegative().optional().nullable(),
  capacityPallets: z.number().int().nonnegative().optional().nullable(),
  maxStops: z.number().int().min(1).max(500).optional().nullable(),
  odometerKm: z.number().nonnegative().default(0),
  branchId: z.string().uuid().optional().nullable(),
  departmentId: z.string().uuid().optional().nullable(),
  gpsDeviceId: z.string().max(64).optional().nullable(),
  speedLimitKmh: z.number().int().min(10).max(200).optional().nullable(),
  tankCapacityL: z.number().positive().max(2000).optional().nullable(),
  acquiredAt: optionalDate,
  /** Cost of ownership: owned → straight-line depreciation; leased/rented → monthly cost. */
  purchasePrice: z.number().nonnegative().max(1e13).optional().nullable(),
  residualValue: z.number().nonnegative().max(1e13).optional().nullable(),
  usefulLifeMonths: z.number().int().min(1).max(600).optional().nullable(),
  monthlyLeaseCost: z.number().nonnegative().max(1e12).optional().nullable(),
  inServiceAt: optionalDate,
  /** S18: trailers and equipment are vehicles of another asset kind. */
  assetKind: z.enum(['VEHICLE', 'TRAILER', 'CONTAINER', 'GENERATOR', 'FORKLIFT', 'EQUIPMENT']).default('VEHICLE'),
  meterType: z.enum(['KM', 'HOURS', 'NONE']).default('KM'),
  hourMeter: z.number().nonnegative().max(1_000_000).optional().nullable(),
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
export const updateBranchSchema = createBranchSchema.partial().extend({ active: z.boolean().optional() });
export type UpdateBranchInput = z.infer<typeof updateBranchSchema>;

export const createDriverSchema = z.object({
  employeeNo: z.string().trim().min(1).max(32),
  fullName: z.string().trim().min(1).max(128),
  phone: z.string().max(32).optional().nullable(),
  branchId: z.string().uuid().optional().nullable(),
  licenseNumber: z.string().max(64).optional().nullable(),
  licenseClass: z
    .string()
    .trim()
    .transform((v, ctx) => {
      const c = normalizeLicenceClass(v);
      if (!c) ctx.addIssue({ code: 'custom', message: 'Unknown licence class (use T, A, B, C, D, E, TR, TW, CO or the Myanmar letter)' });
      return c ?? v;
    }).optional().nullable(),
  licenseIssuedAt: optionalDate,
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
  licenseClass: z
    .string()
    .trim()
    .transform((v, ctx) => {
      const c = normalizeLicenceClass(v);
      if (!c) ctx.addIssue({ code: 'custom', message: 'Unknown licence class (use T, A, B, C, D, E, TR, TW, CO or the Myanmar letter)' });
      return c ?? v;
    }),
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
  /** Harsh driving from GPS speed/heading changes (km/h per second, g). */
  harshAccelKmhPerS: z.number().min(3).max(40).default(10),
  harshBrakeKmhPerS: z.number().min(3).max(40).default(12),
  harshCornerG: z.number().min(0.1).max(1.5).default(0.4),
  /** Computed harsh events need fixes at most this far apart (sparser data is skipped). */
  harshMaxGapSeconds: z.number().int().min(1).max(60).default(15),
});
export type TelematicsSettings = z.infer<typeof telematicsSettingsSchema>;

export const companySettingsSchema = z.object({
  telematics: telematicsSettingsSchema.default({}),
  // Declared lazily: dispatchSettingsSchema is defined further down this file.
  dispatch: z.lazy(() => dispatchSettingsSchema).default({}),
  maintenance: z.lazy(() => maintenanceSettingsSchema).default({}),
  safety: z.lazy(() => safetySettingsSchema).default({}),
  inspections: z.lazy(() => inspectionSettingsSchema).default({}),
  incentives: z.lazy(() => incentiveSettingsSchema).default({}),
  approvals: z.lazy(() => approvalSettingsSchema).default({}),
  logistics: z.lazy(() => logisticsSettingsSchema).default({}),
  pod: z.lazy(() => podSettingsSchema).default({}),
  control: z.lazy(() => controlSettingsSchema).default({}),
  fuelControl: z.lazy(() => fuelControlSettingsSchema).default({}),
  diagnostics: z.lazy(() => diagnosticsSettingsSchema).default({}),
  security: z.lazy(() => securitySettingsSchema).default({}),
  tires: z.lazy(() => tireSettingsSchema).default({}),
  lifecycle: z.lazy(() => lifecycleSettingsSchema).default({}),
  compliance: z.lazy(() => complianceSettingsSchema).default({}),
});
export type CompanySettings = z.infer<typeof companySettingsSchema>;

export const updateCompanySettingsSchema = z.object({
  telematics: telematicsSettingsSchema.partial().optional(),
  dispatch: z.lazy(() => dispatchSettingsSchema.partial()).optional(),
  maintenance: z.lazy(() => maintenanceSettingsSchema.partial()).optional(),
  safety: z.lazy(() => safetySettingsSchema.partial()).optional(),
  inspections: z.lazy(() => inspectionSettingsSchema.partial()).optional(),
  incentives: z.lazy(() => incentiveSettingsSchema.partial()).optional(),
  approvals: z.lazy(() => approvalSettingsSchema.partial()).optional(),
  logistics: z.lazy(() => logisticsSettingsSchema.partial()).optional(),
  pod: z.lazy(() => podSettingsSchema.partial()).optional(),
  control: z.lazy(() => controlSettingsSchema.partial()).optional(),
  fuelControl: z.lazy(() => fuelControlSettingsSchema.partial()).optional(),
  diagnostics: z.lazy(() => diagnosticsSettingsSchema.partial()).optional(),
  security: z.lazy(() => securitySettingsSchema.partial()).optional(),
  tires: z.lazy(() => tireSettingsSchema.partial()).optional(),
  lifecycle: z.lazy(() => lifecycleSettingsSchema.partial()).optional(),
  compliance: z.lazy(() => complianceSettingsSchema.partial()).optional(),
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
    .default(DEFAULT_LICENCE_RULES),
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
    /** Where the fill happened (driver phone GPS). */
    latitude: z.number().min(-90).max(90).optional().nullable(),
    longitude: z.number().min(-180).max(180).optional().nullable(),
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
    /** S18: engine hours (equipment). */
    intervalHours: z.number().int().min(10).max(100_000).optional().nullable(),
    lastDoneHours: z.number().nonnegative().optional().nullable(),
    active: z.boolean().default(true),
  })
  .refine((p) => p.intervalKm || p.intervalDays || p.intervalHours, { path: ['intervalKm'], message: 'Set intervalKm, intervalDays and/or intervalHours' });
export type MaintenancePlanInput = z.infer<typeof maintenancePlanSchema>;

/** Create the same plan for many vehicles at once (e.g. all trucks). */
export const bulkMaintenancePlanSchema = z.object({
  vehicleIds: z.array(z.string().uuid()).min(1).max(500),
  name: z.string().trim().min(1).max(128),
  intervalKm: z.number().int().min(100).max(1_000_000).optional().nullable(),
  intervalDays: z.number().int().min(1).max(3650).optional().nullable(),
  intervalHours: z.number().int().min(10).max(100_000).optional().nullable(),
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
  /** Outside garage (S16). */
  supplierId: z.string().uuid().optional().nullable(),
  quoteAmount: z.number().nonnegative().optional().nullable(),
  quoteFileId: z.string().uuid().optional().nullable(),
  offRoad: z.boolean().default(true),
  odometerKm: z.number().nonnegative().optional().nullable(),
  planId: z.string().uuid().optional().nullable(),
  repairRequestIds: z.array(z.string().uuid()).max(50).optional(),
  /** Planned cost; above settings.approvals.workOrderAbove the work order needs approval. */
  estimatedCost: z.number().nonnegative().optional().nullable(),
});
export type CreateWorkOrderInput = z.infer<typeof createWorkOrderSchema>;

export const workOrderLineSchema = z.object({
  kind: z.enum(['LABOUR', 'PART', 'EXTERNAL', 'TIRE', 'OTHER']),
  description: z.string().trim().min(1).max(300),
  quantity: z.number().positive().max(100_000),
  unitCost: z.number().nonnegative(),
});
export type WorkOrderLineInput = z.infer<typeof workOrderLineSchema>;

export const completeWorkOrderSchema = z.object({
  resolution: z.string().trim().min(3).max(4000),
  completedAt: z.coerce.date().optional(),
  odometerKm: z.number().nonnegative().optional(),
  /** Garage invoice (S16): required when the work order has a garage. */
  invoiceNo: z.string().trim().max(60).optional().nullable(),
  invoiceDate: z.coerce.date().optional().nullable(),
  invoiceAmount: z.number().nonnegative().optional().nullable(),
  invoiceFileId: z.string().uuid().optional().nullable(),
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

// ---------------------------------------------------------------------------
// Costs & analytics (Sprint 6)
// ---------------------------------------------------------------------------

export const ExpenseCategory = {
  TOLL: 'TOLL',
  PARKING: 'PARKING',
  FINE: 'FINE',
  INSURANCE: 'INSURANCE',
  ROAD_TAX: 'ROAD_TAX',
  DRIVER_ALLOWANCE: 'DRIVER_ALLOWANCE',
  CLEANING: 'CLEANING',
  LEASE: 'LEASE',
  OTHER: 'OTHER',
} as const;

export const createExpenseSchema = z.object({
  vehicleId: z.string().uuid(),
  tripId: z.string().uuid().optional().nullable(),
  category: z.nativeEnum(ExpenseCategory),
  incurredAt: z.coerce.date(),
  amount: z.number().positive().max(1e12),
  description: z.string().max(500).optional().nullable(),
  receiptFileId: z.string().uuid().optional().nullable(),
});
export type CreateExpenseInput = z.infer<typeof createExpenseSchema>;

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
export const analyticsRangeSchema = z
  .object({ from: isoDay, to: isoDay, branchId: z.string().uuid().optional() })
  .refine((r) => r.from <= r.to, { path: ['to'], message: '`to` must not be before `from`' })
  .refine((r) => (Date.parse(r.to) - Date.parse(r.from)) / 86_400_000 <= 366, { path: ['to'], message: 'At most one year' });
export type AnalyticsRange = z.infer<typeof analyticsRangeSchema>;

export const registerDeviceSchema = z.object({
  pushToken: z.string().min(10).max(300),
  platform: z.enum(['ios', 'android', 'web']),
});
export type RegisterDeviceInput = z.infer<typeof registerDeviceSchema>;

// ---------------------------------------------------------------------------
// Safety (Phase 2 / S7)
// ---------------------------------------------------------------------------

export const safetySettingsSchema = z.object({
  /** Penalty points per event (or per 10 idle minutes); score = 100 − points per 100 km. */
  weights: z
    .object({
      overspeed: z.number().min(0).max(50).default(5),
      harshBrake: z.number().min(0).max(50).default(4),
      harshAccel: z.number().min(0).max(50).default(3),
      harshCorner: z.number().min(0).max(50).default(3),
      idlePer10Min: z.number().min(0).max(50).default(1),
    })
    .default({}),
  /** Below this distance in the period there is not enough data for a score. */
  minDistanceKm: z.number().min(0).max(10_000).default(50),
  /** Drivers scoring below this are flagged (and managers alerted). */
  alertBelow: z.number().min(0).max(100).default(70),
});
export type SafetySettings = z.infer<typeof safetySettingsSchema>;

export const IncidentType = {
  COLLISION: 'COLLISION',
  DAMAGE: 'DAMAGE',
  THEFT: 'THEFT',
  INJURY: 'INJURY',
  NEAR_MISS: 'NEAR_MISS',
  BREAKDOWN: 'BREAKDOWN',
  OTHER: 'OTHER',
} as const;

export const createIncidentSchema = z.object({
  vehicleId: z.string().uuid().optional().nullable(),
  driverId: z.string().uuid().optional().nullable(),
  tripId: z.string().uuid().optional().nullable(),
  type: z.nativeEnum(IncidentType),
  severity: z.nativeEnum(RepairSeverity).default('MEDIUM'),
  occurredAt: z.coerce.date(),
  latitude: z.number().min(-90).max(90).optional().nullable(),
  longitude: z.number().min(-180).max(180).optional().nullable(),
  location: z.string().max(300).optional().nullable(),
  description: z.string().trim().min(5).max(4000),
  injuries: z.boolean().default(false),
  thirdParty: z.string().max(2000).optional().nullable(),
  policeReportNo: z.string().max(64).optional().nullable(),
  estimatedCost: z.number().nonnegative().optional().nullable(),
  photoFileIds: z.array(z.string().uuid()).max(20).default([]),
});
export type CreateIncidentInput = z.infer<typeof createIncidentSchema>;

export const updateIncidentSchema = z.object({
  severity: z.nativeEnum(RepairSeverity).optional(),
  status: z.enum(['REPORTED', 'INVESTIGATING', 'CLOSED']).optional(),
  findings: z.string().max(4000).optional().nullable(),
  correctiveActions: z.string().max(4000).optional().nullable(),
  estimatedCost: z.number().nonnegative().optional().nullable(),
  policeReportNo: z.string().max(64).optional().nullable(),
  thirdParty: z.string().max(2000).optional().nullable(),
  workOrderId: z.string().uuid().optional().nullable(),
  driverId: z.string().uuid().optional().nullable(),
  photoFileIds: z.array(z.string().uuid()).max(20).optional(),
});
export type UpdateIncidentInput = z.infer<typeof updateIncidentSchema>;

export const createClaimSchema = z.object({
  insurer: z.string().max(200).optional().nullable(),
  policyNo: z.string().max(64).optional().nullable(),
  externalRef: z.string().max(64).optional().nullable(),
  amountClaimed: z.number().positive(),
  notes: z.string().max(2000).optional().nullable(),
});
export type CreateClaimInput = z.infer<typeof createClaimSchema>;

export const updateClaimSchema = z.object({
  status: z.enum(['SUBMITTED', 'APPROVED', 'REJECTED', 'SETTLED']).optional(),
  externalRef: z.string().max(64).optional().nullable(),
  amountApproved: z.number().nonnegative().optional().nullable(),
  amountPaid: z.number().nonnegative().optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});
export type UpdateClaimInput = z.infer<typeof updateClaimSchema>;

// ---------------------------------------------------------------------------
// Inspections, training, incentives (Phase 2 / S8)
// ---------------------------------------------------------------------------

export const inspectionSettingsSchema = z.object({
  /** Trips can only start after a pre-trip inspection of the vehicle (that did not fail). */
  requirePreTrip: z.boolean().default(false),
  /** How long a pre-trip inspection stays valid. */
  preTripValidHours: z.number().int().min(1).max(72).default(12),
});
export type InspectionSettings = z.infer<typeof inspectionSettingsSchema>;

export const incentiveSettingsSchema = z.object({
  /** Monthly job proposes a safety bonus for drivers at or above minScore. */
  safetyBonusEnabled: z.boolean().default(false),
  safetyBonusMinScore: z.number().min(0).max(100).default(90),
  safetyBonusAmount: z.number().nonnegative().default(30_000),
  /** Days before a training certificate expires to start alerting. */
  trainingAlertDays: z.number().int().min(1).max(180).default(30),
});
export type IncentiveSettings = z.infer<typeof incentiveSettingsSchema>;

export const InspectionKind = { PRE_TRIP: 'PRE_TRIP', POST_TRIP: 'POST_TRIP', PERIODIC: 'PERIODIC' } as const;
export type InspectionKind = (typeof InspectionKind)[keyof typeof InspectionKind];

export const checklistItemSchema = z.object({
  key: z.string().trim().min(1).max(40).regex(/^[a-z0-9_]+$/, 'lowercase letters, digits and _'),
  label: z.string().trim().min(1).max(200),
  critical: z.boolean().default(false),
  /** 'number': a measured value (S16 tires); outside min/max counts as a defect. */
  type: z.enum(['check', 'number']).optional(),
  unit: z.string().max(10).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  /** Tire readings feed tire_checks. */
  tirePosition: z.string().max(10).optional(),
  measure: z.enum(['TREAD', 'PRESSURE']).optional(),
});
export type ChecklistItem = z.infer<typeof checklistItemSchema>;

export const createInspectionTemplateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  kind: z.nativeEnum(InspectionKind),
  vehicleClasses: z.array(z.string().trim().toUpperCase()).default([]),
  items: z
    .array(checklistItemSchema)
    .min(1)
    .max(100)
    .refine((a) => new Set(a.map((i) => i.key)).size === a.length, 'Item keys must be unique'),
  active: z.boolean().default(true),
});
export type CreateInspectionTemplateInput = z.infer<typeof createInspectionTemplateSchema>;
export const updateInspectionTemplateSchema = createInspectionTemplateSchema.partial();
export type UpdateInspectionTemplateInput = z.infer<typeof updateInspectionTemplateSchema>;

export const inspectionAnswerSchema = z.object({
  key: z.string(),
  ok: z.boolean(),
  /** For 'number' items; ok is then decided from min/max. */
  value: z.number().optional().nullable(),
  note: z.string().trim().max(500).optional().nullable(),
  photoFileId: z.string().uuid().optional().nullable(),
});
export type InspectionAnswer = z.infer<typeof inspectionAnswerSchema>;

export const createInspectionSchema = z.object({
  vehicleId: z.string().uuid(),
  templateId: z.string().uuid(),
  tripId: z.string().uuid().optional().nullable(),
  driverId: z.string().uuid().optional().nullable(),
  performedAt: z.coerce.date().optional(),
  odometerKm: z.number().nonnegative().optional().nullable(),
  latitude: z.number().min(-90).max(90).optional().nullable(),
  longitude: z.number().min(-180).max(180).optional().nullable(),
  answers: z.array(inspectionAnswerSchema).min(1).max(100),
  notes: z.string().trim().max(2000).optional().nullable(),
});
export type CreateInspectionInput = z.infer<typeof createInspectionSchema>;

export const createCourseSchema = z.object({
  code: z.string().trim().toUpperCase().min(1).max(32),
  name: z.string().trim().min(2).max(160),
  description: z.string().max(2000).optional().nullable(),
  validityMonths: z.number().int().min(1).max(120).optional().nullable(),
  mandatory: z.boolean().default(false),
  active: z.boolean().default(true),
});
export type CreateCourseInput = z.infer<typeof createCourseSchema>;
export const updateCourseSchema = createCourseSchema.partial();
export type UpdateCourseInput = z.infer<typeof updateCourseSchema>;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');
export const createTrainingRecordSchema = z.object({
  courseId: z.string().uuid(),
  completedAt: isoDate,
  /** Defaults to completedAt + course validity. */
  expiresAt: isoDate.optional().nullable(),
  provider: z.string().max(160).optional().nullable(),
  score: z.number().min(0).max(100).optional().nullable(),
  certificateNo: z.string().max(64).optional().nullable(),
  certificateFileId: z.string().uuid().optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});
export type CreateTrainingRecordInput = z.infer<typeof createTrainingRecordSchema>;

export const AdjustmentCategory = {
  SAFETY_BONUS: 'SAFETY_BONUS',
  FUEL_EFFICIENCY: 'FUEL_EFFICIENCY',
  ON_TIME: 'ON_TIME',
  ATTENDANCE: 'ATTENDANCE',
  TRAFFIC_FINE: 'TRAFFIC_FINE',
  DAMAGE: 'DAMAGE',
  POLICY_VIOLATION: 'POLICY_VIOLATION',
  OTHER: 'OTHER',
} as const;
export type AdjustmentCategory = (typeof AdjustmentCategory)[keyof typeof AdjustmentCategory];

export const periodSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'YYYY-MM');
export const createAdjustmentSchema = z.object({
  driverId: z.string().uuid(),
  kind: z.enum(['INCENTIVE', 'PENALTY']),
  category: z.nativeEnum(AdjustmentCategory),
  period: periodSchema,
  amount: z.number().positive().max(1_000_000_000),
  reason: z.string().trim().min(3).max(1000),
  incidentId: z.string().uuid().optional().nullable(),
});
export type CreateAdjustmentInput = z.infer<typeof createAdjustmentSchema>;
export const updateAdjustmentSchema = createAdjustmentSchema.omit({ driverId: true }).partial();
export type UpdateAdjustmentInput = z.infer<typeof updateAdjustmentSchema>;
export const decideAdjustmentSchema = z.object({ note: z.string().trim().max(1000).optional().nullable() });

// ---------------------------------------------------------------------------
// Integrations & approvals (Phase 2 / S9)
// ---------------------------------------------------------------------------

/** Amounts above which an approval is required; null = never. */
const limit = z.number().nonnegative().nullable().default(null);
export const approvalSettingsSchema = z.object({
  workOrderAbove: limit,
  expenseAbove: limit,
  fuelAbove: limit,
  claimAbove: limit,
  /** At or above this amount two different approvers are needed. */
  secondApproverAbove: limit,
});
export type ApprovalSettings = z.infer<typeof approvalSettingsSchema>;

export const decisionSchema = z.object({ note: z.string().trim().max(1000).optional().nullable() });
export type DecisionInput = z.infer<typeof decisionSchema>;

export const ApiScope = {
  ORDERS_WRITE: 'orders:write',
  ORDERS_READ: 'orders:read',
  TRIPS_READ: 'trips:read',
  VEHICLES_READ: 'vehicles:read',
  TRACKING_READ: 'tracking:read',
} as const;
export type ApiScope = (typeof ApiScope)[keyof typeof ApiScope];

export const createApiKeySchema = z.object({
  name: z.string().trim().min(2).max(100),
  scopes: z.array(z.nativeEnum(ApiScope)).min(1),
  expiresAt: z.coerce.date().optional().nullable(),
});
export type CreateApiKeyInput = z.infer<typeof createApiKeySchema>;

export const WebhookEvent = {
  ORDER_RECEIVED: 'order.received',
  ORDER_UPDATED: 'order.updated',
  ORDER_CANCELLED: 'order.cancelled',
  TRIP_ASSIGNED: 'trip.assigned',
  TRIP_STARTED: 'trip.started',
  TRIP_COMPLETED: 'trip.completed',
  TRIP_CANCELLED: 'trip.cancelled',
  VEHICLE_OVERSPEED: 'vehicle.overspeed',
  VEHICLE_GEOFENCE_ENTER: 'vehicle.geofence_enter',
  VEHICLE_GEOFENCE_EXIT: 'vehicle.geofence_exit',
  VEHICLE_GPS_OFFLINE: 'vehicle.gps_offline',
  INSPECTION_FAILED: 'inspection.failed',
  APPROVAL_REQUESTED: 'approval.requested',
  APPROVAL_APPROVED: 'approval.approved',
  APPROVAL_REJECTED: 'approval.rejected',
  ORDER_PLANNED: 'order.planned',
  ORDER_DISPATCHED: 'order.dispatched',
  ORDER_DELIVERED: 'order.delivered',
  ORDER_PARTIALLY_DELIVERED: 'order.partially_delivered',
  ORDER_FAILED: 'order.failed',
  RETURN_COLLECTED: 'return.collected',
  LOAD_CHECKED_IN: 'load.checked_in',
  VEHICLE_OFF_ROUTE: 'vehicle.off_route',
  VEHICLE_UNAUTHORISED_USE: 'vehicle.unauthorised_use',
  VEHICLE_FUEL_DROP: 'vehicle.fuel_drop',
  VEHICLE_ENGINE_FAULT: 'vehicle.engine_fault',
  STOCK_LOW: 'stock.low',
  WARRANTY_CLAIM_UPDATED: 'warranty_claim.updated',
} as const;
export type WebhookEvent = (typeof WebhookEvent)[keyof typeof WebhookEvent];

export const webhookEndpointSchema = z.object({
  url: z.string().trim().url().max(2000),
  description: z.string().max(300).optional().nullable(),
  events: z.array(z.nativeEnum(WebhookEvent)).min(1),
  active: z.boolean().default(true),
});
export type WebhookEndpointInput = z.infer<typeof webhookEndpointSchema>;
export const updateWebhookEndpointSchema = webhookEndpointSchema.partial();
export type UpdateWebhookEndpointInput = z.infer<typeof updateWebhookEndpointSchema>;

const ref = z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9._\-/]+$/, 'letters, digits and . _ - / only');
export const orderCustomerSchema = z.object({
  code: ref,
  name: z.string().trim().min(1).max(200),
  phone: z.string().max(50).optional().nullable(),
  email: z.string().email().max(200).optional().nullable(),
  address: z.string().max(500).optional().nullable(),
  township: z.string().max(100).optional().nullable(),
  city: z.string().max(100).optional().nullable(),
  latitude: z.number().min(-90).max(90).optional().nullable(),
  longitude: z.number().min(-180).max(180).optional().nullable(),
});
export const orderLineSchema = z.object({
  sku: z.string().trim().min(1).max(64),
  description: z.string().max(300).optional().nullable(),
  quantity: z.number().positive().max(10_000_000),
  uom: z.string().trim().min(1).max(16).default('EA'),
  /** Total weight of the line. */
  weightKg: z.number().nonnegative().optional().nullable(),
  /** Total volume of the line. */
  volumeM3: z.number().nonnegative().optional().nullable(),
  /** Number of cases (cartons) on the line. */
  cases: z.number().nonnegative().optional().nullable(),
  /** Pallet places used by the line. */
  pallets: z.number().nonnegative().optional().nullable(),
});
export const OrderPriority = { LOW: 'LOW', NORMAL: 'NORMAL', HIGH: 'HIGH', URGENT: 'URGENT' } as const;
export const upsertOrderSchema = z
  .object({
    customer: orderCustomerSchema,
    /** Branch code of the depot that ships the order (default: settings.logistics.defaultBranchId). */
    depotCode: z.string().trim().min(1).max(16).optional().nullable(),
    /** Planned delivery day (company-local); defaults to the delivery window start, else the day received. */
    deliveryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD').optional().nullable(),
    orderDate: z.coerce.date().optional().nullable(),
    priority: z.nativeEnum(OrderPriority).default('NORMAL'),
    deliveryWindow: z.object({ start: z.coerce.date(), end: z.coerce.date() }).optional().nullable(),
    address: z.string().max(500).optional().nullable(),
    latitude: z.number().min(-90).max(90).optional().nullable(),
    longitude: z.number().min(-180).max(180).optional().nullable(),
    contactName: z.string().max(200).optional().nullable(),
    contactPhone: z.string().max(50).optional().nullable(),
    codAmount: z.number().nonnegative().optional().nullable(),
    notes: z.string().max(2000).optional().nullable(),
    lines: z.array(orderLineSchema).min(1).max(500),
  })
  .refine((o) => !o.deliveryWindow || o.deliveryWindow.start < o.deliveryWindow.end, { path: ['deliveryWindow', 'end'], message: 'end must be after start' })
  .refine((o) => (o.latitude == null) === (o.longitude == null), { path: ['longitude'], message: 'latitude and longitude go together' });
export type UpsertOrderInput = z.infer<typeof upsertOrderSchema>;
export const orderRefSchema = ref;
export const batchOrdersSchema = z.object({
  orders: z
    .array(z.object({ externalRef: ref, order: z.unknown() }))
    .min(1)
    .max(200),
});
export const cancelOrderSchema = z.object({ reason: z.string().trim().max(500).optional().nullable() });

export const createVehicleRequestSchema = z
  .object({
    purpose: z.string().trim().min(3).max(300),
    originName: z.string().trim().min(1).max(200),
    destinationName: z.string().trim().min(1).max(200),
    plannedStart: z.coerce.date(),
    plannedEnd: z.coerce.date(),
    passengers: z.number().int().min(0).max(100).optional().nullable(),
    cargoDescription: z.string().max(500).optional().nullable(),
    preferredClass: z.string().trim().toUpperCase().max(20).optional().nullable(),
    notes: z.string().max(2000).optional().nullable(),
  })
  .refine((r) => r.plannedEnd > r.plannedStart, { path: ['plannedEnd'], message: 'must be after plannedStart' });
export type CreateVehicleRequestInput = z.infer<typeof createVehicleRequestSchema>;
export const scheduleVehicleRequestSchema = z.object({ vehicleId: z.string().uuid(), driverId: z.string().uuid() });

// ---------------------------------------------------------------------------
// Delivery planning (Phase 2 / S10)
// ---------------------------------------------------------------------------

export const DEFAULT_FAILURE_REASONS = ['Customer closed', 'Customer refused', 'No payment / COD not ready', 'Wrong address', 'Goods damaged', 'No time', 'Other'];

export const logisticsSettingsSchema = z.object({
  /** Depot for orders that do not name one. */
  defaultBranchId: z.string().uuid().nullable().default(null),
  /** Stop limit for vehicles that have none. */
  defaultMaxStops: z.number().int().min(1).max(500).nullable().default(30),
  failureReasons: z.array(z.string().trim().min(1).max(80)).min(1).max(30).default(DEFAULT_FAILURE_REASONS),
  /** Default departure time of a load, company-local HH:MM. */
  departureTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).default('07:30'),
  /** Used to estimate a load's planned end. */
  serviceMinutesPerStop: z.number().int().min(1).max(240).default(15),
  avgSpeedKmh: z.number().min(5).max(120).default(25),
  /** Driver cost per trip day, added to delivery cost KPIs (optional). */
  driverCostPerDay: z.number().nonnegative().nullable().default(null),
  /** GPS auto-arrive: a vehicle stopped within this distance of a delivery stop is marked arrived (null = off). */
  arrivalRadiusM: z.number().int().min(30).max(2000).nullable().default(150),
});
export type LogisticsSettings = z.infer<typeof logisticsSettingsSchema>;

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');
export const planningQuerySchema = z.object({ date: day, branchId: z.string().uuid() });
export const autofillSchema = z.object({ date: day, branchId: z.string().uuid(), vehicleIds: z.array(z.string().uuid()).max(200).optional() });
export const createLoadSchema = z.object({
  date: day,
  branchId: z.string().uuid(),
  vehicleId: z.string().uuid(),
  driverId: z.string().uuid(),
  orderIds: z.array(z.string().uuid()).min(1).max(500),
  departAt: z.coerce.date().optional().nullable(),
});
export type CreateLoadInput = z.infer<typeof createLoadSchema>;
export const updateLoadSchema = z.object({
  addOrderIds: z.array(z.string().uuid()).max(500).optional(),
  removeOrderIds: z.array(z.string().uuid()).max(500).optional(),
  /** Full new stop order. */
  stopIds: z.array(z.string().uuid()).max(500).optional(),
  vehicleId: z.string().uuid().optional(),
  driverId: z.string().uuid().optional(),
});
export type UpdateLoadInput = z.infer<typeof updateLoadSchema>;

/** When an action really happened on the phone (offline queue): not in the future, at most 7 days ago. */
export const clientTimeSchema = z.coerce
  .date()
  .refine((d) => d.getTime() <= Date.now() + 5 * 60_000, 'Time is in the future')
  .refine((d) => d.getTime() >= Date.now() - 7 * 86_400_000, 'Time is more than 7 days ago');
export const driverActionSchema = z.object({ occurredAt: clientTimeSchema.optional() });
export type DriverActionInput = z.infer<typeof driverActionSchema>;

export const stopOutcomeSchema = z
  .object({
    /** Offline: when the stop was really completed. */
    occurredAt: clientTimeSchema.optional(),
    outcome: z.enum(['DELIVERED', 'PARTIAL', 'FAILED']),
    reason: z.string().trim().max(200).optional().nullable(),
    notes: z.string().max(1000).optional().nullable(),
    /** Proof of delivery photos (files uploaded first). */
    photoFileIds: z.array(z.string().uuid()).max(10).default([]),
    /** Recipient signature as strokes of [x, y] points (0–1 normalised to the pad). */
    signature: z
      .object({
        name: z.string().trim().min(1).max(120),
        strokes: z
          .array(z.array(z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)])).min(1).max(2000))
          .min(1)
          .max(100),
      })
      .optional()
      .nullable(),
    latitude: z.number().min(-90).max(90).optional().nullable(),
    longitude: z.number().min(-180).max(180).optional().nullable(),
    accuracyM: z.number().nonnegative().max(100_000).optional().nullable(),
    /** Cash actually collected at the stop. */
    codCollected: z.number().nonnegative().optional().nullable(),
    /** PARTIAL: delivered quantity per order line (lines not listed count as fully delivered). */
    deliveredLines: z
      .array(z.object({ orderId: z.string().uuid(), lineNo: z.number().int().min(1), quantity: z.number().nonnegative() }))
      .max(1000)
      .optional(),
  })
  .refine((o) => o.outcome !== 'FAILED' || !!o.reason, { path: ['reason'], message: 'A reason is required for a failed delivery' })
  .refine((o) => o.outcome !== 'PARTIAL' || (o.deliveredLines?.length ?? 0) > 0, { path: ['deliveredLines'], message: 'List the delivered quantities' });
export type StopOutcomeInput = z.infer<typeof stopOutcomeSchema>;

export const updateCustomerSchema = z.object({
  phone: z.string().max(50).optional().nullable(),
  address: z.string().max(500).optional().nullable(),
  township: z.string().max(100).optional().nullable(),
  city: z.string().max(100).optional().nullable(),
  latitude: z.number().min(-90).max(90).optional().nullable(),
  longitude: z.number().min(-180).max(180).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});
export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;

// ---------------------------------------------------------------------------
// Proof of delivery, returns, check-in, delivery KPIs (Phase 2 / S11)
// ---------------------------------------------------------------------------

export const podSettingsSchema = z.object({
  requirePhoto: z.boolean().default(true),
  requireSignature: z.boolean().default(false),
  /** Deliveries completed farther than this from the customer are flagged. */
  maxDistanceM: z.number().int().min(25).max(50_000).default(300),
  /** Drivers must enter the cash collected when the stop has COD. */
  requireCodEntry: z.boolean().default(true),
});
export type PodSettings = z.infer<typeof podSettingsSchema>;

export const createReturnSchema = z.object({
  orderId: z.string().uuid().optional().nullable(),
  sku: z.string().trim().min(1).max(64),
  description: z.string().max(300).optional().nullable(),
  quantity: z.number().positive().max(1_000_000),
  uom: z.string().trim().min(1).max(16).default('EA'),
  reason: z.string().trim().min(2).max(200),
  photoFileId: z.string().uuid().optional().nullable(),
});
export type CreateReturnInput = z.infer<typeof createReturnSchema>;

export const checkInSchema = z.object({
  /** key from the expected list (order line or return) → quantity physically received. */
  lines: z.array(z.object({ key: z.string().min(1).max(100), receivedQty: z.number().nonnegative() })).max(2000),
  cashReceived: z.number().nonnegative().optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});
export type CheckInInput = z.infer<typeof checkInSchema>;

export const deliveryKpiQuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  branchId: z.string().uuid().optional(),
});

// ---------------------------------------------------------------------------
// Costs & control (Sprint 12)
// ---------------------------------------------------------------------------

/** Cost categories of the ledger (budgets and TCO use the same keys). */
export const CostCategory = {
  FUEL: 'FUEL',
  MAINTENANCE: 'MAINTENANCE',
  ...ExpenseCategory,
  DOCUMENTS: 'DOCUMENTS',
  DEPRECIATION: 'DEPRECIATION',
  SHARED: 'SHARED',
  TIRES: 'TIRES',
} as const;
export type CostCategory = (typeof CostCategory)[keyof typeof CostCategory];

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:MM');
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'YYYY-MM');

/** Working window for a weekday; null = closed all day. end < start means the shift runs past midnight. */
const dayHours = z.object({ start: hhmm, end: hhmm }).nullable();

export const controlSettingsSchema = z.object({
  offRouteEnabled: z.boolean().default(true),
  /** Distance from the planned route that counts as off-route. */
  offRouteMeters: z.number().int().min(100).max(20_000).default(500),
  /** Minutes off-route before an alert. */
  offRouteMinutes: z.number().int().min(1).max(120).default(5),
  /** Opt-in: fleets that move without trips (pool cars, mock telematics) would otherwise alert constantly. */
  movementWithoutTrip: z.boolean().default(false),
  /** km driven without an ongoing trip before an alert. */
  movementWithoutTripKm: z.number().min(0.2).max(100).default(1),
  workingHoursEnabled: z.boolean().default(false),
  /** Index 0 = Sunday … 6 = Saturday (company time zone). */
  workingHours: z
    .array(dayHours)
    .length(7)
    .default([null, { start: '06:00', end: '20:00' }, { start: '06:00', end: '20:00' }, { start: '06:00', end: '20:00' }, { start: '06:00', end: '20:00' }, { start: '06:00', end: '20:00' }, { start: '06:00', end: '14:00' }]),
  requireDriverOnDuty: z.boolean().default(false),
  restrictedAreaAlerts: z.boolean().default(true),
});
export type ControlSettings = z.infer<typeof controlSettingsSchema>;

export const budgetLineSchema = z.object({
  period: month,
  branchId: z.string().uuid().optional().nullable(),
  departmentId: z.string().uuid().optional().nullable(),
  category: z.nativeEnum(CostCategory),
  /** 0 or null removes the budget line. */
  amount: z.number().nonnegative().max(1e13).nullable(),
});
export const upsertBudgetsSchema = z.object({
  lines: z
    .array(budgetLineSchema)
    .min(1)
    .max(5000)
    .refine((ls) => ls.every((l) => !(l.branchId && l.departmentId)), 'A budget line is for a branch or a department, not both'),
});
export type UpsertBudgetsInput = z.infer<typeof upsertBudgetsSchema>;

export const budgetQuerySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  dimension: z.enum(['company', 'branch', 'department']).default('branch'),
});

export const copyBudgetsSchema = z.object({
  fromYear: z.number().int().min(2000).max(2100),
  toYear: z.number().int().min(2000).max(2100),
  /** Percentage change applied to every amount (e.g. 5 = +5 %). */
  changePct: z.number().min(-90).max(500).default(0),
  overwrite: z.boolean().default(false),
});

export const createSharedCostSchema = z.object({
  period: month,
  branchId: z.string().uuid().optional().nullable(),
  departmentId: z.string().uuid().optional().nullable(),
  category: z.nativeEnum(CostCategory).default('OTHER'),
  description: z.string().trim().min(2).max(300),
  amount: z.number().positive().max(1e13),
});
export type CreateSharedCostInput = z.infer<typeof createSharedCostSchema>;

export const costQuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  branchId: z.string().uuid().optional(),
  departmentId: z.string().uuid().optional(),
});
export type CostQuery = z.infer<typeof costQuerySchema>;

// ---------------------------------------------------------------------------
// Fuel control, fuel cards, sensors, diagnostics (Sprint 13)
// ---------------------------------------------------------------------------

export const fuelControlSettingsSchema = z.object({
  /** Fill location vs the vehicle's GPS position at fill time. */
  locationMaxM: z.number().int().min(100).max(20_000).default(500),
  /** Odometer km vs GPS km between two fills. */
  kmMismatchPct: z.number().min(5).max(100).default(15),
  /** Fuel level sensor rules (when the GPS device reports a level). */
  sensorEnabled: z.boolean().default(true),
  refillMinL: z.number().min(2).max(500).default(15),
  dropMinL: z.number().min(2).max(500).default(10),
  /** A sensor refill this much larger than the recorded litres is flagged. */
  refillToleranceL: z.number().min(0).max(100).default(5),
  /** Card reconciliation tolerances. */
  matchHours: z.number().min(0.5).max(48).default(2),
  matchLitresPct: z.number().min(0).max(50).default(3),
  matchAmountPct: z.number().min(0).max(50).default(2),
  /** Fuel card provider API sync (adapter chosen by the FUEL_CARD_API environment setting). */
  cardSyncEnabled: z.boolean().default(false),
  cardSyncProvider: z.string().trim().max(40).default('API'),
  /** Saved statement column mappings per provider name (filled when an import is committed). */
  cardMappings: z.record(z.string(), z.lazy(() => fuelCardMappingSchema)).default({}),
});
export type FuelControlSettings = z.infer<typeof fuelControlSettingsSchema>;

export const diagnosticsSettingsSchema = z.object({
  coolantMaxC: z.number().min(60).max(150).default(105),
  batteryMinV: z.number().min(5).max(30).default(11.5),
  /** Trouble codes (or prefixes like "P03") that open a repair request automatically. */
  autoRepairCodes: z.array(z.string().trim().toUpperCase().regex(/^[PBCU][0-9A-F]{1,4}$/)).max(200).default([]),
});
export type DiagnosticsSettings = z.infer<typeof diagnosticsSettingsSchema>;

export const fuelCardSchema = z.object({
  provider: z.string().trim().min(2).max(40),
  /** Full number or last digits; only the last 4 are stored. */
  number: z.string().trim().regex(/^[0-9 *-]{4,30}$/),
  label: z.string().trim().max(80).optional().nullable(),
  vehicleId: z.string().uuid().optional().nullable(),
  driverId: z.string().uuid().optional().nullable(),
  active: z.boolean().default(true),
});
export type FuelCardInput = z.infer<typeof fuelCardSchema>;
export const updateFuelCardSchema = fuelCardSchema.omit({ provider: true, number: true }).partial();

/** Statement column mapping: FMS field → column header in the file. */
export const fuelCardMappingSchema = z.object({
  provider: z.string().trim().min(2).max(40),
  columns: z.object({
    occurredAt: z.string().min(1),
    card: z.string().min(1),
    amount: z.string().min(1),
    litres: z.string().optional().nullable(),
    station: z.string().optional().nullable(),
    product: z.string().optional().nullable(),
    plate: z.string().optional().nullable(),
    externalId: z.string().optional().nullable(),
  }),
  /** Day order for ambiguous dates like 03/04/2026. */
  dateFormat: z.enum(['YMD', 'DMY', 'MDY']).default('DMY'),
  /** Rows whose product contains one of these words are not fuel (shop, car wash…). */
  nonFuelWords: z.array(z.string().trim().min(1)).max(50).default(['shop', 'wash', 'lubric']),
});
export type FuelCardMapping = z.infer<typeof fuelCardMappingSchema>;

export const reviewCardTxnSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('accept'), note: z.string().trim().min(3).max(500) }),
  z.object({ action: z.literal('create_record'), odometerKm: z.number().nonnegative(), fullTank: z.boolean().default(true) }),
  z.object({ action: z.literal('link'), fuelRecordId: z.string().uuid() }),
  z.object({ action: z.literal('non_fuel'), note: z.string().trim().max(500).optional() }),
]);
export type ReviewCardTxnInput = z.infer<typeof reviewCardTxnSchema>;

// ---------------------------------------------------------------------------
// Site visits, group administration, invitations (Sprint 14)
// ---------------------------------------------------------------------------

export const siteVisitQuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  category: z.string().max(40).optional(),
  vehicleId: z.string().uuid().optional(),
});
export type SiteVisitQuery = z.infer<typeof siteVisitQuerySchema>;

/** Passwords: at least 10 characters with a letter and a digit. */
export const passwordSchema = z
  .string()
  .min(10, 'At least 10 characters')
  .max(200)
  .refine((p) => /[A-Za-z]/.test(p) && /\d/.test(p), 'Use letters and at least one digit');

export const createCompanySchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{2,20}$/, '2–20 letters, digits or -'),
  name: z.string().trim().min(2).max(120),
  timezone: z.string().trim().min(3).max(60).default('Asia/Yangon'),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/).default('MMK'),
  /** First company admin, invited by email. */
  admin: z.object({ email: z.string().trim().toLowerCase().email(), fullName: z.string().trim().min(1).max(128) }),
});
export type CreateCompanyInput = z.infer<typeof createCompanySchema>;
export const updateCompanySchema = z.object({ name: z.string().trim().min(2).max(120).optional(), active: z.boolean().optional() });

export const inviteUserSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  fullName: z.string().trim().min(1).max(128),
  roles: z.array(z.string()).min(1).max(8),
  branchId: z.string().uuid().optional().nullable(),
});
export type InviteUserInput = z.infer<typeof inviteUserSchema>;

export const updateUserSchema = z.object({
  fullName: z.string().trim().min(1).max(128).optional(),
  roles: z.array(z.string()).min(1).max(8).optional(),
  branchId: z.string().uuid().nullable().optional(),
  active: z.boolean().optional(),
});
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

export const forgotPasswordSchema = z.object({ email: z.string().trim().toLowerCase().email() });
export const setPasswordSchema = z.object({ token: z.string().min(20).max(200), password: passwordSchema });

// ---------------------------------------------------------------------------
// SSO, BI access, scheduled reports (Sprint 15)
// ---------------------------------------------------------------------------

export const securitySettingsSchema = z.object({
  /** false: users of this company must sign in with SSO (super admins keep password sign-in). */
  passwordLogin: z.boolean().default(true),
});

export const ssoProviderSchema = z.object({
  kind: z.enum(['ENTRA', 'GOOGLE']),
  /** Entra: tenant id (GUID); Google: Workspace domain (hd). */
  tenant: z.string().trim().min(3).max(100),
  clientId: z.string().trim().min(3).max(200),
  clientSecret: z.string().min(3).max(500),
  enabled: z.boolean().default(true),
});
export type SsoProviderInput = z.infer<typeof ssoProviderSchema>;
export const updateSsoProviderSchema = ssoProviderSchema.partial();

export const ssoDomainSchema = z
  .object({
    domain: z.string().trim().toLowerCase().regex(/^([a-z0-9-]+\.)+[a-z]{2,}$/, 'A domain like example.com'),
    source: z.enum(['GROUP_ENTRA', 'GROUP_GOOGLE', 'COMPANY']),
    providerId: z.string().uuid().optional().nullable(),
  })
  .refine((d) => d.source !== 'COMPANY' || !!d.providerId, { path: ['providerId'], message: 'Choose the company provider' });
export type SsoDomainInput = z.infer<typeof ssoDomainSchema>;

export const ReportKind = { FLEET: 'FLEET', BUDGET: 'BUDGET', DELIVERY: 'DELIVERY', SAFETY: 'SAFETY' } as const;
export type ReportKind = (typeof ReportKind)[keyof typeof ReportKind];

export const reportSubscriptionSchema = z.object({
  report: z.nativeEnum(ReportKind),
  frequency: z.enum(['DAILY', 'WEEKLY', 'MONTHLY']),
  branchId: z.string().uuid().optional().nullable(),
  userIds: z.array(z.string().uuid()).max(100).default([]),
  extraEmails: z.array(z.string().trim().toLowerCase().email()).max(50).default([]),
  enabled: z.boolean().default(true),
});
export type ReportSubscriptionInput = z.infer<typeof reportSubscriptionSchema>;

export const biLoginSchema = z.object({
  /** null = the group login (all companies). */
  companyId: z.string().uuid().nullable(),
});

// ---------------------------------------------------------------------------
// Workshop depth (Sprint 16): suppliers, parts & stock, tires, warranty
// ---------------------------------------------------------------------------

export const SupplierKind = { GARAGE: 'GARAGE', PARTS: 'PARTS', TIRES: 'TIRES', OTHER: 'OTHER' } as const;
export const supplierSchema = z.object({
  name: z.string().trim().min(2).max(120),
  kinds: z.array(z.nativeEnum(SupplierKind)).min(1).default(['GARAGE']),
  phone: z.string().trim().max(40).optional().nullable(),
  email: z.string().trim().toLowerCase().email().optional().nullable().or(z.literal('').transform(() => null)),
  address: z.string().trim().max(300).optional().nullable(),
  taxId: z.string().trim().max(40).optional().nullable(),
  paymentTermsDays: z.number().int().min(0).max(365).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  externalRef: z.string().trim().max(40).optional().nullable(),
  active: z.boolean().default(true),
});
export type SupplierInput = z.infer<typeof supplierSchema>;

/** Garage, quote and invoice of a work order (outside garages). */
export const workOrderGarageSchema = z.object({
  supplierId: z.string().uuid().nullable().optional(),
  quoteAmount: z.number().nonnegative().nullable().optional(),
  quoteFileId: z.string().uuid().nullable().optional(),
  invoiceNo: z.string().trim().max(60).nullable().optional(),
  invoiceDate: z.coerce.date().nullable().optional(),
  invoiceAmount: z.number().nonnegative().nullable().optional(),
  invoiceFileId: z.string().uuid().nullable().optional(),
});
export type WorkOrderGarageInput = z.infer<typeof workOrderGarageSchema>;

export const partSchema = z.object({
  partNo: z.string().trim().min(1).max(60),
  name: z.string().trim().min(2).max(200),
  category: z.string().trim().max(60).optional().nullable(),
  unit: z.string().trim().min(1).max(10).default('pcs'),
  supplierId: z.string().uuid().optional().nullable(),
  minQty: z.number().nonnegative().max(1_000_000).default(0),
  reorderQty: z.number().nonnegative().max(1_000_000).default(0),
  warrantyMonths: z.number().int().min(0).max(240).optional().nullable(),
  warrantyKm: z.number().int().min(0).max(2_000_000).optional().nullable(),
  externalRef: z.string().trim().max(40).optional().nullable(),
  active: z.boolean().default(true),
});
export type PartInput = z.infer<typeof partSchema>;

const qty = z.number().positive().max(1_000_000);
export const receiveStockSchema = z.object({
  branchId: z.string().uuid(),
  supplierId: z.string().uuid().optional().nullable(),
  reference: z.string().trim().max(60).optional().nullable(),
  fileId: z.string().uuid().optional().nullable(),
  occurredAt: z.coerce.date().optional(),
  lines: z.array(z.object({ partId: z.string().uuid(), qty, unitCost: z.number().nonnegative().max(1e10) })).min(1).max(200),
});
export type ReceiveStockInput = z.infer<typeof receiveStockSchema>;

export const transferStockSchema = z
  .object({
    fromBranchId: z.string().uuid(),
    toBranchId: z.string().uuid(),
    reference: z.string().trim().max(60).optional().nullable(),
    lines: z.array(z.object({ partId: z.string().uuid(), qty })).min(1).max(200),
  })
  .refine((t) => t.fromBranchId !== t.toBranchId, { path: ['toBranchId'], message: 'Choose another store' });
export type TransferStockInput = z.infer<typeof transferStockSchema>;

export const stockCountSchema = z.object({
  branchId: z.string().uuid(),
  reason: z.string().trim().min(2).max(200),
  lines: z.array(z.object({ partId: z.string().uuid(), countedQty: z.number().min(0).max(1_000_000) })).min(1).max(1000),
});
export type StockCountInput = z.infer<typeof stockCountSchema>;

/** Issue a part from a store to a work order (creates a PART line). */
export const issuePartSchema = z.object({
  partId: z.string().uuid(),
  branchId: z.string().uuid(),
  qty,
  warrantyMonths: z.number().int().min(0).max(240).optional().nullable(),
  warrantyKm: z.number().int().min(0).max(2_000_000).optional().nullable(),
});
export type IssuePartInput = z.infer<typeof issuePartSchema>;

/**
 * Tire positions per layout. Codes: axle number + side (L/R) + O/I for dual wheels;
 * SPARE is the spare wheel. Motorcycles: F/R.
 */
export const TIRE_LAYOUTS: Record<string, { label: string; positions: string[] }> = {
  'moto-2': { label: 'Motorcycle', positions: ['F', 'R'] },
  'tri-3': { label: 'Three-wheeler', positions: ['F', '2L', '2R'] },
  'car-4': { label: 'Car / van / pickup (4 + spare)', positions: ['1L', '1R', '2L', '2R', 'SPARE'] },
  '4x2-6': { label: 'Truck / bus 4×2, dual rear (6 + spare)', positions: ['1L', '1R', '2LO', '2LI', '2RI', '2RO', 'SPARE'] },
  '6x4-10': { label: 'Truck 6×4, dual rear (10 + spare)', positions: ['1L', '1R', '2LO', '2LI', '2RI', '2RO', '3LO', '3LI', '3RI', '3RO', 'SPARE'] },
  'trailer-8': { label: 'Trailer, 2 axles dual (8)', positions: ['1LO', '1LI', '1RI', '1RO', '2LO', '2LI', '2RI', '2RO'] },
  'trailer-12': { label: 'Trailer, 3 axles dual (12)', positions: ['1LO', '1LI', '1RI', '1RO', '2LO', '2LI', '2RI', '2RO', '3LO', '3LI', '3RI', '3RO'] },
};
export const DEFAULT_TIRE_LAYOUT: Record<string, string> = {
  TRUCK: '4x2-6',
  BUS: '4x2-6',
  TRACTOR: '6x4-10',
  TRAILER: 'trailer-8',
  MOTORCYCLE: 'moto-2',
  THREE_WHEELER: 'tri-3',
};
export const tireLayoutOf = (vehicleClass: string, layout?: string | null) =>
  layout && TIRE_LAYOUTS[layout] ? layout : (DEFAULT_TIRE_LAYOUT[vehicleClass] ?? 'car-4');

export const TireReason = { NEW_FIT: 'NEW_FIT', WORN: 'WORN', PUNCTURE: 'PUNCTURE', DAMAGE: 'DAMAGE', ROTATION: 'ROTATION', OTHER: 'OTHER' } as const;
export const tireChangeSchema = z.object({
  position: z.string().trim().min(1).max(10),
  changedAt: z.coerce.date().optional(),
  odometerKm: z.number().nonnegative().optional(),
  reason: z.nativeEnum(TireReason),
  brand: z.string().trim().max(60).optional().nullable(),
  model: z.string().trim().max(60).optional().nullable(),
  size: z.string().trim().max(40).optional().nullable(),
  condition: z.enum(['NEW', 'RETREAD', 'USED']).default('NEW'),
  cost: z.number().nonnegative().max(1e10).default(0),
  supplierId: z.string().uuid().optional().nullable(),
  workOrderId: z.string().uuid().optional().nullable(),
  removedTreadMm: z.number().min(0).max(40).optional().nullable(),
  warrantyMonths: z.number().int().min(0).max(120).optional().nullable(),
  warrantyKm: z.number().int().min(0).max(1_000_000).optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
});
export type TireChangeInput = z.infer<typeof tireChangeSchema>;

export const tireRotateSchema = z
  .object({ a: z.string().max(10), b: z.string().max(10), changedAt: z.coerce.date().optional(), odometerKm: z.number().nonnegative().optional() })
  .refine((r) => r.a !== r.b, { path: ['b'], message: 'Choose two different positions' });
export type TireRotateInput = z.infer<typeof tireRotateSchema>;

export const tireCheckSchema = z.object({
  checkedAt: z.coerce.date().optional(),
  odometerKm: z.number().nonnegative().optional().nullable(),
  readings: z
    .array(z.object({ position: z.string().max(10), treadMm: z.number().min(0).max(40).optional().nullable(), pressure: z.number().min(0).max(250).optional().nullable() }))
    .min(1)
    .max(30),
});
export type TireCheckInput = z.infer<typeof tireCheckSchema>;

export const tireSettingsSchema = z.object({
  /** Legal / safe minimum tread (mm): below it a tire must be replaced. */
  minTreadMm: z.number().min(0.5).max(10).default(3),
  /** Warn this many mm above the minimum. */
  warnTreadMm: z.number().min(0).max(10).default(1),
  /** Pressure unit shown to users. */
  pressureUnit: z.enum(['psi', 'kPa', 'bar']).default('psi'),
  /** Target pressure per vehicle class (in pressureUnit); none = pressure not judged. */
  pressureTargets: z.record(z.string(), z.number().positive()).default({}),
  tolerancePct: z.number().min(1).max(50).default(10),
  /** Expected km of a tire, for "beyond expected life" alerts and cost forecasts. */
  expectedLifeKm: z.number().int().min(1000).max(1_000_000).default(80_000),
});
export type TireSettings = z.infer<typeof tireSettingsSchema>;

export const WarrantyComponent = { WHOLE_VEHICLE: 'WHOLE_VEHICLE', ENGINE: 'ENGINE', GEARBOX: 'GEARBOX', BATTERY: 'BATTERY', BODY: 'BODY', OTHER: 'OTHER' } as const;
export const vehicleWarrantySchema = z
  .object({
    component: z.nativeEnum(WarrantyComponent),
    label: z.string().trim().max(120).optional().nullable(),
    supplierId: z.string().uuid().optional().nullable(),
    startDate: z.coerce.date(),
    endDate: z.coerce.date().optional().nullable(),
    endKm: z.number().nonnegative().optional().nullable(),
    terms: z.string().max(2000).optional().nullable(),
    fileId: z.string().uuid().optional().nullable(),
  })
  .refine((w) => w.endDate || w.endKm != null, { path: ['endDate'], message: 'Give an end date and/or an end km' });
export type VehicleWarrantyInput = z.infer<typeof vehicleWarrantySchema>;

export const WarrantyClaimStatus = { DRAFT: 'DRAFT', SUBMITTED: 'SUBMITTED', APPROVED: 'APPROVED', REJECTED: 'REJECTED', RECOVERED: 'RECOVERED' } as const;
export const createWarrantyClaimSchema = z.object({
  vehicleId: z.string().uuid(),
  workOrderId: z.string().uuid().optional().nullable(),
  supplierId: z.string().uuid().optional().nullable(),
  basis: z.enum(['VEHICLE', 'PART', 'TIRE']),
  basisRef: z.string().uuid().optional().nullable(),
  description: z.string().trim().min(3).max(2000),
  amountClaimed: z.number().nonnegative().max(1e10),
  notes: z.string().max(2000).optional().nullable(),
  fileIds: z.array(z.string().uuid()).max(10).default([]),
});
export type CreateWarrantyClaimInput = z.infer<typeof createWarrantyClaimSchema>;

export const updateWarrantyClaimSchema = z.object({
  action: z.enum(['SUBMIT', 'APPROVE', 'REJECT', 'RECOVER', 'EDIT']),
  amountClaimed: z.number().nonnegative().max(1e10).optional(),
  amountApproved: z.number().nonnegative().max(1e10).optional(),
  amountRecovered: z.number().nonnegative().max(1e10).optional(),
  at: z.coerce.date().optional(),
  notes: z.string().max(2000).optional().nullable(),
  fileIds: z.array(z.string().uuid()).max(10).optional(),
});
export type UpdateWarrantyClaimInput = z.infer<typeof updateWarrantyClaimSchema>;

// ---------------------------------------------------------------------------
// Lifecycle and benchmarking (Sprint 17)
// ---------------------------------------------------------------------------

/** Replacement limits for a vehicle class; null = not used. */
export const replacementLimitsSchema = z.object({
  maxAgeYears: z.number().min(1).max(40).nullable().default(null),
  maxKm: z.number().int().min(10_000).max(5_000_000).nullable().default(null),
  /** Downtime (under repair) over the last 12 months, %. */
  maxDowntimePct: z.number().min(1).max(100).nullable().default(null),
});
export type ReplacementLimits = z.infer<typeof replacementLimitsSchema>;

const DEFAULT_LIMITS: Record<string, { maxAgeYears: number; maxKm: number; maxDowntimePct: number }> = {
  TRUCK: { maxAgeYears: 10, maxKm: 600_000, maxDowntimePct: 15 },
  TRACTOR: { maxAgeYears: 10, maxKm: 800_000, maxDowntimePct: 15 },
  BUS: { maxAgeYears: 12, maxKm: 700_000, maxDowntimePct: 15 },
  VAN: { maxAgeYears: 8, maxKm: 300_000, maxDowntimePct: 12 },
  PICKUP: { maxAgeYears: 8, maxKm: 300_000, maxDowntimePct: 12 },
  CAR: { maxAgeYears: 7, maxKm: 250_000, maxDowntimePct: 10 },
  MOTORCYCLE: { maxAgeYears: 5, maxKm: 100_000, maxDowntimePct: 10 },
};

export const lifecycleSettingsSchema = z.object({
  /** Limits per vehicle class (missing classes use the defaults above). */
  limits: z.record(z.string(), replacementLimitsSchema.partial()).default({}),
  /** Flag when the running cost per km (12 months) is this % above the class median. */
  costAboveClassPct: z.number().min(5).max(500).default(30),
  /** "Plan replacement" when a limit will be reached within this many months. */
  planWithinMonths: z.number().int().min(1).max(60).default(12),
});
export type LifecycleSettings = z.infer<typeof lifecycleSettingsSchema>;

export function replacementLimitsFor(settings: LifecycleSettings, vehicleClass: string) {
  const d = DEFAULT_LIMITS[vehicleClass] ?? { maxAgeYears: null, maxKm: null, maxDowntimePct: null };
  const o = settings.limits[vehicleClass] ?? {};
  return {
    maxAgeYears: o.maxAgeYears !== undefined ? o.maxAgeYears : d.maxAgeYears,
    maxKm: o.maxKm !== undefined ? o.maxKm : d.maxKm,
    maxDowntimePct: o.maxDowntimePct !== undefined ? o.maxDowntimePct : d.maxDowntimePct,
  } as { maxAgeYears: number | null; maxKm: number | null; maxDowntimePct: number | null };
}

export const DisposalMethod = { SALE: 'SALE', SCRAP: 'SCRAP', TRADE_IN: 'TRADE_IN', TRANSFER: 'TRANSFER', WRITE_OFF: 'WRITE_OFF' } as const;
export const disposeVehicleSchema = z.object({
  disposedAt: z.coerce.date(),
  method: z.nativeEnum(DisposalMethod),
  buyer: z.string().trim().max(200).optional().nullable(),
  saleValue: z.number().nonnegative().max(1e12).default(0),
  odometerKm: z.number().nonnegative().optional().nullable(),
  reason: z.string().trim().max(2000).optional().nullable(),
  fileId: z.string().uuid().optional().nullable(),
});
export type DisposeVehicleInput = z.infer<typeof disposeVehicleSchema>;

export const replacementPlanSchema = z.object({
  replacementPlannedFor: z.coerce.date().nullable(),
  replacementNote: z.string().trim().max(500).optional().nullable(),
});
export type ReplacementPlanInput = z.infer<typeof replacementPlanSchema>;

// ---------------------------------------------------------------------------
// Trailers & equipment, compliance, safety audits (Sprint 18)
// ---------------------------------------------------------------------------

export const AssetKind = { VEHICLE: 'VEHICLE', TRAILER: 'TRAILER', CONTAINER: 'CONTAINER', GENERATOR: 'GENERATOR', FORKLIFT: 'FORKLIFT', EQUIPMENT: 'EQUIPMENT' } as const;
export type AssetKind = (typeof AssetKind)[keyof typeof AssetKind];

export const meterReadingSchema = z.object({
  kind: z.enum(['KM', 'HOURS']),
  value: z.number().nonnegative().max(5_000_000),
  readAt: z.coerce.date().optional(),
  note: z.string().trim().max(300).optional().nullable(),
});
export type MeterReadingInput = z.infer<typeof meterReadingSchema>;

export const tripTrailerSchema = z.object({ trailerId: z.string().uuid().nullable() });

/** A document a vehicle must hold (country rule pack). */
export const requiredDocumentSchema = z.object({
  type: z.enum(['REGISTRATION', 'INSURANCE', 'ROAD_TAX', 'PERMIT', 'INSPECTION', 'OTHER']),
  label: z.string().trim().min(2).max(120),
  /** Vehicle classes it applies to; empty = all classes. */
  vehicleClasses: z.array(z.string()).default([]),
  /** Asset kinds it applies to (trailers have their own registration). */
  assetKinds: z.array(z.string()).default(['VEHICLE']),
  /** Usual validity (months), used when a document has no expiry date. */
  renewMonths: z.number().int().min(1).max(120).nullable().default(12),
  /** Missing or expired → the vehicle cannot be assigned or start a trip. */
  blockDispatch: z.boolean().default(true),
});
export type RequiredDocument = z.infer<typeof requiredDocumentSchema>;

/**
 * Myanmar default pack. The values are a starting point: check them against the current
 * RTAD / Ministry of Transport rules and edit them in Settings → Compliance.
 */
export const MYANMAR_PACK: RequiredDocument[] = [
  { type: 'REGISTRATION', label: 'Vehicle licence (RTAD registration, annual renewal)', vehicleClasses: [], assetKinds: ['VEHICLE', 'TRAILER'], renewMonths: 12, blockDispatch: true },
  { type: 'INSURANCE', label: 'Third-party liability insurance', vehicleClasses: [], assetKinds: ['VEHICLE'], renewMonths: 12, blockDispatch: true },
  { type: 'INSPECTION', label: 'Roadworthiness inspection', vehicleClasses: ['TRUCK', 'TRACTOR', 'BUS', 'VAN', 'PICKUP', 'TRAILER'], assetKinds: ['VEHICLE', 'TRAILER'], renewMonths: 12, blockDispatch: true },
  { type: 'PERMIT', label: 'Transport permit (goods / passenger carriage)', vehicleClasses: ['TRUCK', 'TRACTOR', 'BUS'], assetKinds: ['VEHICLE'], renewMonths: 12, blockDispatch: false },
];

export const complianceSettingsSchema = z.object({
  /** Rule pack the requirements came from (MM = Myanmar). */
  country: z.string().max(10).default('MM'),
  requirements: z.array(requiredDocumentSchema).max(50).default(MYANMAR_PACK),
  /**
   * Master switch: when on, requirements with blockDispatch stop assignment and trip start.
   * Off by default so that turning on the pack never blocks a fleet before its documents are entered.
   */
  enforceDispatch: z.boolean().default(false),
  /** "Expiring" this many days before the end. */
  warnDays: z.number().int().min(1).max(180).default(30),
  /** Legal maximum payload per vehicle class (kg); with a trailer the trailer's own limit is added. */
  maxPayloadKg: z.record(z.string(), z.number().positive().max(200_000)).default({}),
});
export type ComplianceSettings = z.infer<typeof complianceSettingsSchema>;

export const auditQuestionSchema = z.object({
  key: z.string().trim().min(1).max(40).regex(/^[a-z0-9_]+$/),
  section: z.string().trim().max(80).default('General'),
  label: z.string().trim().min(2).max(300),
  weight: z.number().int().min(1).max(5).default(1),
  critical: z.boolean().default(false),
});
export type AuditQuestion = z.infer<typeof auditQuestionSchema>;

export const auditTemplateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  target: z.enum(['BRANCH', 'VEHICLE']),
  questions: z
    .array(auditQuestionSchema)
    .min(1)
    .max(200)
    .refine((q) => new Set(q.map((x) => x.key)).size === q.length, 'Question keys must be unique'),
  passMark: z.number().int().min(1).max(100).default(80),
  active: z.boolean().default(true),
});
export type AuditTemplateInput = z.infer<typeof auditTemplateSchema>;

export const createAuditSchema = z
  .object({
    templateId: z.string().uuid(),
    branchId: z.string().uuid().optional().nullable(),
    vehicleId: z.string().uuid().optional().nullable(),
    performedAt: z.coerce.date().optional(),
    auditorName: z.string().trim().max(120).optional().nullable(),
    answers: z
      .array(z.object({ key: z.string(), result: z.enum(['PASS', 'FAIL', 'NA']), note: z.string().trim().max(1000).optional().nullable(), photoFileId: z.string().uuid().optional().nullable() }))
      .min(1)
      .max(200),
    /** Corrective actions for failed items (others can be added later). */
    actions: z
      .array(z.object({ questionKey: z.string().optional().nullable(), description: z.string().trim().min(3).max(1000), ownerUserId: z.string().uuid().optional().nullable(), dueDate: z.coerce.date() }))
      .max(200)
      .default([]),
    notes: z.string().trim().max(2000).optional().nullable(),
  })
  .refine((a) => !!a.branchId !== !!a.vehicleId, { path: ['branchId'], message: 'Choose a branch or a vehicle' });
export type CreateAuditInput = z.infer<typeof createAuditSchema>;

export const correctiveActionSchema = z.object({
  description: z.string().trim().min(3).max(1000),
  ownerUserId: z.string().uuid().optional().nullable(),
  dueDate: z.coerce.date(),
  questionKey: z.string().optional().nullable(),
});
export const updateCorrectiveActionSchema = z.object({
  action: z.enum(['DONE', 'VERIFY', 'REOPEN', 'EDIT']),
  closureNote: z.string().trim().max(1000).optional().nullable(),
  evidenceFileId: z.string().uuid().optional().nullable(),
  ownerUserId: z.string().uuid().optional().nullable(),
  dueDate: z.coerce.date().optional(),
});
export type UpdateCorrectiveActionInput = z.infer<typeof updateCorrectiveActionSchema>;
