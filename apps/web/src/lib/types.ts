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
  telematics: {
    speedLimitKmh: number;
    overspeedHysteresisKmh: number;
    idleMinutes: number;
    offlineMinutes: number;
  };
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
