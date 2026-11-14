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
  /** Planned cost; above settings.approvals.workOrderAbove the work order needs approval. */
  estimatedCost: z.number().nonnegative().optional().nullable(),
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
});
export const OrderPriority = { LOW: 'LOW', NORMAL: 'NORMAL', HIGH: 'HIGH', URGENT: 'URGENT' } as const;
export const upsertOrderSchema = z
  .object({
    customer: orderCustomerSchema,
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
