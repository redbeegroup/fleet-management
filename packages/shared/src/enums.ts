export const VehicleStatus = {
  AVAILABLE: 'AVAILABLE',
  ASSIGNED: 'ASSIGNED',
  OPERATING: 'OPERATING',
  UNDER_REPAIR: 'UNDER_REPAIR',
  INACTIVE: 'INACTIVE',
  DISPOSED: 'DISPOSED',
} as const;
export type VehicleStatus = (typeof VehicleStatus)[keyof typeof VehicleStatus];

export const VehicleClass = {
  TRUCK: 'TRUCK',
  VAN: 'VAN',
  CAR: 'CAR',
  PICKUP: 'PICKUP',
  BUS: 'BUS',
  MOTORCYCLE: 'MOTORCYCLE',
  TRAILER: 'TRAILER',
  OTHER: 'OTHER',
} as const;
export type VehicleClass = (typeof VehicleClass)[keyof typeof VehicleClass];

export const OwnershipType = { OWNED: 'OWNED', LEASED: 'LEASED', RENTED: 'RENTED', CONTRACTOR: 'CONTRACTOR' } as const;
export type OwnershipType = (typeof OwnershipType)[keyof typeof OwnershipType];

export const DocumentType = {
  REGISTRATION: 'REGISTRATION',
  INSURANCE: 'INSURANCE',
  ROAD_TAX: 'ROAD_TAX',
  PERMIT: 'PERMIT',
  INSPECTION: 'INSPECTION',
  OTHER: 'OTHER',
} as const;
export type DocumentType = (typeof DocumentType)[keyof typeof DocumentType];

export const TripStatus = {
  PLANNED: 'PLANNED',
  ASSIGNED: 'ASSIGNED',
  ONGOING: 'ONGOING',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
} as const;
export type TripStatus = (typeof TripStatus)[keyof typeof TripStatus];

/**
 * Allowed vehicle status transitions. DISPOSED is terminal.
 */
export const VEHICLE_STATUS_TRANSITIONS: Record<VehicleStatus, VehicleStatus[]> = {
  AVAILABLE: ['ASSIGNED', 'OPERATING', 'UNDER_REPAIR', 'INACTIVE'],
  ASSIGNED: ['AVAILABLE', 'OPERATING', 'UNDER_REPAIR', 'INACTIVE'],
  OPERATING: ['AVAILABLE', 'ASSIGNED', 'UNDER_REPAIR'],
  UNDER_REPAIR: ['AVAILABLE', 'INACTIVE'],
  INACTIVE: ['AVAILABLE', 'DISPOSED'],
  DISPOSED: [],
};

export const NotificationSeverity = { INFO: 'info', WARNING: 'warning', CRITICAL: 'critical' } as const;
export type NotificationSeverity = (typeof NotificationSeverity)[keyof typeof NotificationSeverity];

/** Content types accepted for uploads (documents, photos, signatures). */
export const ALLOWED_UPLOAD_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
] as const;

export const TelemetryEventType = {
  GEOFENCE_ENTER: 'GEOFENCE_ENTER',
  GEOFENCE_EXIT: 'GEOFENCE_EXIT',
  OVERSPEED: 'OVERSPEED',
  IDLE: 'IDLE',
  IGNITION_ON: 'IGNITION_ON',
  IGNITION_OFF: 'IGNITION_OFF',
  GPS_OFFLINE: 'GPS_OFFLINE',
  GPS_RESTORED: 'GPS_RESTORED',
} as const;
export type TelemetryEventType = (typeof TelemetryEventType)[keyof typeof TelemetryEventType];
