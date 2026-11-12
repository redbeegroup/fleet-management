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
