import type { DocumentType, VehicleClass, VehicleStatus } from '@fms/shared';

export interface Branch {
  id: string;
  code: string;
  name: string;
}

export interface Vehicle {
  id: string;
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

export interface VehicleDocument {
  id: string;
  type: DocumentType;
  number: string | null;
  expiresAt: string | null;
  vehicle?: { id: string; plateNumber: string };
}

export interface VehicleDetail extends Vehicle {
  documents: VehicleDocument[];
  assignments: { id: string; startAt: string; driver: { id: string; fullName: string; employeeNo: string } | null }[];
  statusHistory: { id: string; fromStatus: VehicleStatus | null; toStatus: VehicleStatus; reason: string | null; createdAt: string }[];
}

export interface Driver {
  id: string;
  employeeNo: string;
  fullName: string;
  phone: string | null;
  active: boolean;
  licenses: { number: string; licenseClass: string; expiresAt: string | null }[];
  assignments: { vehicle: { id: string; plateNumber: string } }[];
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
