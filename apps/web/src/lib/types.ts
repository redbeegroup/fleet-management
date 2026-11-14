import type { DocumentType, VehicleClass, VehicleStatus } from '@fms/shared';

export interface Branch {
  id: string;
  code: string;
  name: string;
}

export interface Vehicle {
  id: string;
  branchId?: string | null;
  departmentId?: string | null;
  capacityM3?: string | null;
  notes?: string | null;
  acquiredAt?: string | null;
  plateNumber: string;
  vin: string | null;
  make: string;
  model: string;
  year: number | null;
  vehicleClass: VehicleClass;
  ownership: string;
  fuelType: string | null;
  capacityKg: string | null;
  odometerKm: string;
  status: VehicleStatus;
  gpsDeviceId: string | null;
  speedLimitKmh?: number | null;
  tankCapacityL?: string | null;
  branch: Branch | null;
}

export interface FileRef {
  id: string;
  filename: string;
  contentType: string;
}

export interface VehicleDocument {
  id: string;
  type: DocumentType;
  number: string | null;
  expiresAt: string | null;
  file?: FileRef | null;
  vehicle?: { id: string; plateNumber: string };
}

export interface VehicleDetail extends Vehicle {
  documents: VehicleDocument[];
  assignments: { id: string; startAt: string; driver: { id: string; fullName: string; employeeNo: string } | null }[];
  statusHistory: { id: string; fromStatus: VehicleStatus | null; toStatus: VehicleStatus; reason: string | null; createdAt: string }[];
}

export interface DriverLicense {
  id: string;
  number: string;
  licenseClass: string;
  issuedAt: string | null;
  expiresAt: string | null;
  file?: FileRef | null;
}

export interface Driver {
  id: string;
  employeeNo: string;
  fullName: string;
  phone: string | null;
  active: boolean;
  branchId: string | null;
  licenses: DriverLicense[];
  assignments: { id: string; startAt: string; endAt: string | null; vehicle: { id: string; plateNumber: string } }[];
  user?: { id: string; email: string } | null;
}

export interface HistoryEvent {
  at: string;
  kind: 'status' | 'assignment' | 'document';
  summary: string;
  refId: string;
}

export interface AppNotification {
  id: string;
  topic: string;
  severity: 'info' | 'warning' | 'critical';
  title: string;
  body: string;
  data: { link?: string } | null;
  readAt: string | null;
  createdAt: string;
}

export interface LivePosition {
  vehicleId: string;
  latitude: number;
  longitude: number;
  speedKmh: number | null;
  ignition: boolean | null;
  recordedAt: string;
  offline: boolean;
  vehicle: { id: string; plateNumber: string; status: VehicleStatus; vehicleClass: VehicleClass };
}

export interface Geofence {
  id: string;
  name: string;
  category: string;
  shape: 'CIRCLE' | 'POLYGON';
  centerLat: number | null;
  centerLng: number | null;
  radiusM: number | null;
  polygon: [number, number][] | null;
  alertOnEnter: boolean;
  alertOnExit: boolean;
  active: boolean;
}

export interface TelemetryEvent {
  id: string;
  vehicleId: string;
  plateNumber?: string | null;
  type: string;
  occurredAt: string;
  endedAt: string | null;
  latitude: number | null;
  longitude: number | null;
  speedKmh: number | null;
  geofenceId: string | null;
  data: Record<string, unknown> | null;
}

export interface TrackPoint {
  recordedAt: string;
  latitude: number;
  longitude: number;
  speedKmh: number | null;
  ignition: boolean | null;
}

export interface TrackResponse {
  vehicle: { id: string; plateNumber: string };
  points: TrackPoint[];
  events: TelemetryEvent[];
  summary: {
    distanceKm: number;
    maxSpeedKmh: number;
    avgMovingSpeedKmh: number;
    movingMinutes: number;
    stops: number;
    from: string | null;
    to: string | null;
  };
}

export interface CompanySettings {
  dispatch: { enforceLicenceClass: boolean; licenceRules: Record<string, string[]> };
  telematics: {
    speedLimitKmh: number;
    overspeedHysteresisKmh: number;
    idleMinutes: number;
    offlineMinutes: number;
  };
  safety: { minDistanceKm: number; alertBelow: number; weights: Record<string, number> };
  inspections: { requirePreTrip: boolean; preTripValidHours: number };
  incentives: { safetyBonusEnabled: boolean; safetyBonusMinScore: number; safetyBonusAmount: number; trainingAlertDays: number };
  approvals: { workOrderAbove: number | null; expenseAbove: number | null; fuelAbove: number | null; claimAbove: number | null; secondApproverAbove: number | null };
}

export interface Trip {
  id: string;
  tripNo: string;
  status: 'PLANNED' | 'ASSIGNED' | 'ONGOING' | 'COMPLETED' | 'CANCELLED';
  purpose: string | null;
  originName: string;
  destinationName: string;
  plannedStart: string;
  plannedEnd: string;
  actualStart: string | null;
  actualEnd: string | null;
  startOdometerKm: string | null;
  endOdometerKm: string | null;
  gpsDistanceKm: string | null;
  cargoDescription: string | null;
  cargoWeightKg: string | null;
  notes: string | null;
  cancelReason: string | null;
  vehicleId: string | null;
  driverId: string | null;
  vehicle: { id: string; plateNumber: string; vehicleClass: string; make: string; model: string } | null;
  driver: { id: string; fullName: string; employeeNo: string; phone: string | null } | null;
  statusHistory?: { id: string; fromStatus: string | null; toStatus: string; note: string | null; createdAt: string }[];
}

export interface Availability {
  vehicles: { id: string; plateNumber: string; vehicleClass: string; status: string; make: string; model: string; available: boolean; reasons: string[] }[];
  drivers: { id: string; fullName: string; employeeNo: string; onDuty: boolean; licenceClasses: string[]; available: boolean; reasons: string[] }[];
}

export interface Attendance {
  day: string;
  timezone: string;
  drivers: {
    id: string;
    fullName: string;
    employeeNo: string;
    present: boolean;
    onDutyNow: boolean;
    firstIn: string | null;
    lastOut: string | null;
    dutyMinutes: number;
    completedTrips: number;
  }[];
}

export interface FuelRecord {
  id: string;
  vehicleId: string;
  filledAt: string;
  odometerKm: string;
  litres: string;
  unitPrice: string;
  totalCost: string;
  station: string | null;
  fullTank: boolean;
  paymentMethod: string | null;
  receiptFileId: string | null;
  source: string;
  distanceKm: string | null;
  kmPerLitre: string | null;
  flags: string[];
  approvalStatus: 'APPROVED' | 'PENDING' | 'REJECTED';
  vehicle: { id: string; plateNumber: string };
  driver: { id: string; fullName: string } | null;
}

export interface FuelSummaryRow {
  fills: number;
  litres: number;
  cost: number;
  distanceKm: number;
  kmPerLitre: number | null;
  litresPer100Km: number | null;
  costPerKm: number | null;
  flagged: number;
}

export interface FuelSummary {
  fleet: FuelSummaryRow;
  vehicles: (FuelSummaryRow & { id: string; plateNumber: string; vehicleClass: string })[];
}

export interface DueInfo {
  status: 'OK' | 'DUE_SOON' | 'OVERDUE';
  nextDueKm: number | null;
  nextDueAt: string | null;
  remainingKm: number | null;
  remainingDays: number | null;
}

export interface MaintenancePlan {
  id: string;
  name: string;
  intervalKm: number | null;
  intervalDays: number | null;
  lastDoneAt: string | null;
  lastDoneOdometerKm: string | null;
  active: boolean;
  vehicle: { id: string; plateNumber: string; odometerKm: string; status: string };
  openWorkOrder: { id: string; woNo: string; status: string } | null;
  due: DueInfo | null;
}

export interface WorkOrder {
  id: string;
  woNo: string;
  type: string;
  status: 'AWAITING_APPROVAL' | 'OPEN' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
  priority: string;
  estimatedCost: string | null;
  title: string;
  description: string | null;
  workshop: string | null;
  assignedTo: string | null;
  offRoad: boolean;
  odometerKm: string | null;
  openedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  resolution: string | null;
  totalCost: string;
  vehicle: { id: string; plateNumber: string; status: string };
  plan: { id: string; name: string } | null;
  lines?: { id: string; kind: string; description: string; quantity: string; unitCost: string; total: string }[];
  repairRequests?: RepairRequest[];
}

export interface RepairRequest {
  id: string;
  vehicleId: string;
  description: string;
  severity: string;
  status: 'OPEN' | 'CONVERTED' | 'REJECTED';
  resolution: string | null;
  photoFileId: string | null;
  createdAt: string;
  vehicle?: { id: string; plateNumber: string };
  workOrder?: { id: string; woNo: string; status: string } | null;
}

export interface MaintenanceReport {
  totals: { cost: number; workOrders: number; downtimeMinutes: number };
  vehicles: { id: string; plateNumber: string; vehicleClass: string; status: string; downtimeMinutes: number; downtimePct: number; workOrders: number; cost: number; labour: number; parts: number; external: number }[];
}

export interface FleetKpis {
  vehicles: number;
  days: number;
  distanceKm: number;
  engineHours: number;
  tripsCompleted: number;
  fuelCost: number;
  fuelLitres: number;
  maintenanceCost: number;
  otherCost: number;
  totalCost: number;
  costPerKm: number | null;
  fuelCostPerKm: number | null;
  maintenanceCostPerKm: number | null;
  fuelKmPerLitre: number | null;
  utilizationPct: number | null;
  availabilityPct: number | null;
  downtimePct: number | null;
  idlePct: number | null;
  tripsPerVehiclePerDay: number | null;
  overspeedEvents: number;
  overspeedPer100Km: number | null;
}

export interface VehicleKpis {
  id: string;
  plateNumber: string;
  vehicleClass: string;
  branchName: string | null;
  distanceKm: number;
  daysUsed: number;
  tripsCompleted: number;
  fuelCost: number;
  fuelLitres: number;
  maintenanceCost: number;
  otherCost: number;
  totalCost: number;
  costPerKm: number | null;
  fuelKmPerLitre: number | null;
  utilizationPct: number | null;
  idlePct: number | null;
  downtimeMinutes: number;
  overspeedEvents: number;
  overspeedPer100Km: number | null;
}

export interface Overview {
  range: { from: string; to: string; days: number; timezone: string; currency: string };
  fleet: FleetKpis;
  vehicles: VehicleKpis[];
  branches: (FleetKpis & { branchId: string | null; branchName: string })[];
  expenseByCategory: Record<string, number>;
  pendingApproval: { fuelCost: number; fuelRecords: number; otherCost: number; expenses: number };
  series: { day: string; distanceKm: number; fuelCost: number; maintenanceCost: number; otherCost: number; totalCost: number; activeVehicles: number }[];
}

export interface Expense {
  id: string;
  category: string;
  incurredAt: string;
  amount: string;
  description: string | null;
  approvalStatus: 'APPROVED' | 'PENDING' | 'REJECTED';
  vehicle: { id: string; plateNumber: string };
}

export interface SafetyRow {
  id: string;
  fullName: string;
  employeeNo: string;
  distanceKm: number;
  overspeed: number;
  harshBrake: number;
  harshAccel: number;
  harshCorner: number;
  idleMinutes: number;
  score: number | null;
  pointsPer100Km: number | null;
  band: 'GOOD' | 'FAIR' | 'POOR' | 'INSUFFICIENT_DATA';
}

export interface SafetyScores {
  range: { from: string; to: string; timezone: string };
  settings: { minDistanceKm: number; alertBelow: number; weights: Record<string, number> };
  fleet: {
    drivers: number;
    scoredDrivers: number;
    averageScore: number | null;
    belowThreshold: number;
    distanceKm: number;
    events: { overspeed: number; harshBrake: number; harshAccel: number; harshCorner: number };
  };
  drivers: SafetyRow[];
}

export interface DriverScorecard extends SafetyRow {
  recentEvents: { id: string; type: string; occurredAt: string; speedKmh: number | null; data: Record<string, unknown> | null; vehicleId: string; plateNumber: string | null }[];
}

export interface InsuranceClaim {
  id: string;
  claimNo: string;
  incidentId: string;
  insurer: string | null;
  policyNo: string | null;
  externalRef: string | null;
  status: 'PENDING_APPROVAL' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'SETTLED';
  submittedAt: string;
  amountClaimed: string;
  amountApproved: string | null;
  amountPaid: string | null;
  decidedAt: string | null;
  settledAt: string | null;
  notes: string | null;
  incident?: { id: string; incidentNo: string; type: string; vehicle: { plateNumber: string } | null };
}

export interface Incident {
  id: string;
  incidentNo: string;
  type: string;
  severity: string;
  status: 'REPORTED' | 'INVESTIGATING' | 'CLOSED';
  occurredAt: string;
  latitude: number | null;
  longitude: number | null;
  location: string | null;
  description: string;
  injuries: boolean;
  thirdParty: string | null;
  policeReportNo: string | null;
  estimatedCost: string | null;
  photoFileIds: string[];
  findings: string | null;
  correctiveActions: string | null;
  workOrderId: string | null;
  closedAt: string | null;
  vehicle: { id: string; plateNumber: string } | null;
  driver: { id: string; fullName: string; employeeNo: string } | null;
  claims: InsuranceClaim[];
}

export interface ChecklistItem {
  key: string;
  label: string;
  critical: boolean;
}

export interface InspectionTemplate {
  id: string;
  name: string;
  kind: 'PRE_TRIP' | 'POST_TRIP' | 'PERIODIC';
  vehicleClasses: string[];
  items: ChecklistItem[];
  active: boolean;
}

export interface Inspection {
  id: string;
  inspectionNo: string;
  kind: InspectionTemplate['kind'];
  performedAt: string;
  odometerKm: string | null;
  items: (ChecklistItem & { ok: boolean; note: string | null; photoFileId: string | null })[];
  defects: number;
  criticalDefects: number;
  result: 'PASS' | 'DEFECTS' | 'FAIL';
  notes: string | null;
  repairRequestId: string | null;
  tripId: string | null;
  vehicle: { id: string; plateNumber: string };
  driver: { id: string; fullName: string } | null;
  template: { id: string; name: string };
}

export interface TrainingCourse {
  id: string;
  code: string;
  name: string;
  description: string | null;
  validityMonths: number | null;
  mandatory: boolean;
  active: boolean;
}

export type TrainingState = 'VALID' | 'EXPIRING' | 'EXPIRED' | 'MISSING';

export interface TrainingMatrix {
  today: string;
  courses: { id: string; code: string; name: string; mandatory: boolean; validityMonths: number | null }[];
  drivers: { id: string; fullName: string; employeeNo: string; compliant: boolean; cells: Record<string, { status: TrainingState; expiresAt: string | null }> }[];
  summary: { drivers: number; compliant: number; mandatoryCells: Record<TrainingState, number> };
}

export interface DriverTrainingInfo {
  records: {
    id: string;
    completedAt: string;
    expiresAt: string | null;
    provider: string | null;
    score: string | null;
    certificateNo: string | null;
    certificateFileId: string | null;
    course: { id: string; code: string; name: string };
  }[];
  status: { courseId: string; code: string; name: string; mandatory: boolean; status: TrainingState; expiresAt: string | null; completedAt: string | null }[];
}

export interface Adjustment {
  id: string;
  driverId: string;
  kind: 'INCENTIVE' | 'PENALTY';
  category: string;
  period: string;
  amount: string;
  reason: string;
  status: 'PROPOSED' | 'APPROVED' | 'REJECTED';
  source: string;
  proposedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  createdAt: string;
  driver: { id: string; fullName: string; employeeNo: string };
}

export interface AdjustmentSummary {
  period: string;
  currency: string;
  drivers: { id: string; fullName: string; employeeNo: string; incentives: number; penalties: number; net: number; pending: number }[];
  totals: { incentives: number; penalties: number; net: number; pending: number };
}

export interface ApprovalRequest {
  id: string;
  kind: 'WORK_ORDER' | 'EXPENSE' | 'FUEL' | 'VEHICLE_REQUEST' | 'CLAIM';
  entityId: string;
  title: string;
  amount: string | null;
  requestedBy: string | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  requiredApprovals: number;
  createdAt: string;
  decidedAt: string | null;
  decisions: { id: string; approverId: string; decision: string; note: string | null; createdAt: string }[];
}

export interface VehicleRequest {
  id: string;
  requestNo: string;
  requestedBy: string;
  requesterName: string | null;
  purpose: string;
  originName: string;
  destinationName: string;
  plannedStart: string;
  plannedEnd: string;
  passengers: number | null;
  cargoDescription: string | null;
  preferredClass: string | null;
  notes: string | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'SCHEDULED' | 'CANCELLED';
  rejectionReason: string | null;
  trip: { id: string; tripNo: string; status: string; vehicle: { plateNumber: string } | null; driver: { fullName: string } | null } | null;
}

export interface ApiKeyRow {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  expiresAt: string | null;
  revokedAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  key?: string;
}

export interface WebhookEndpointRow {
  id: string;
  url: string;
  description: string | null;
  events: string[];
  active: boolean;
  consecutiveFailures: number;
  disabledReason: string | null;
  createdAt: string;
  secret?: string;
}

export interface WebhookDeliveryRow {
  id: string;
  endpointId: string;
  event: string;
  status: 'PENDING' | 'SENT' | 'FAILED';
  attempts: number;
  nextAttemptAt: string;
  lastAttemptAt: string | null;
  responseStatus: number | null;
  lastError: string | null;
  deliveredAt: string | null;
  createdAt: string;
}

export interface ApiOrder {
  externalRef: string;
  fmsId: string;
  status: string;
  version: number;
  priority: string;
  deliveryWindow: { start: string; end: string } | null;
  customer: { code: string; name: string; township: string | null; city: string | null };
  totalWeightKg: number | null;
  totalVolumeM3: number | null;
  codAmount: number | null;
  lines: { lineNo: number; sku: string; quantity: number; uom: string }[];
  createdAt: string;
  updatedAt: string;
}
