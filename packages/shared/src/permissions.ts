export const Permission = {
  COMPANY_MANAGE: 'company:manage',
  BRANCH_READ: 'branch:read',
  BRANCH_WRITE: 'branch:write',
  USER_READ: 'user:read',
  USER_WRITE: 'user:write',
  AUDIT_READ: 'audit:read',
  VEHICLE_READ: 'vehicle:read',
  VEHICLE_WRITE: 'vehicle:write',
  VEHICLE_DOCUMENT_WRITE: 'vehicle-document:write',
  DRIVER_READ: 'driver:read',
  DRIVER_WRITE: 'driver:write',
  TRACKING_READ: 'tracking:read',
  TRIP_READ: 'trip:read',
  TRIP_WRITE: 'trip:write',
  FILE_UPLOAD: 'file:upload',
  GEOFENCE_WRITE: 'geofence:write',
  FUEL_READ: 'fuel:read',
  FUEL_WRITE: 'fuel:write',
  MAINTENANCE_READ: 'maintenance:read',
  MAINTENANCE_WRITE: 'maintenance:write',
  REPAIR_REQUEST: 'repair-request:create',
  COST_READ: 'cost:read',
  COST_WRITE: 'cost:write',
  SAFETY_READ: 'safety:read',
  SAFETY_WRITE: 'safety:write',
  INCIDENT_REPORT: 'incident:report',
  INSPECTION_READ: 'inspection:read',
  /** Manage checklists and record inspections for any vehicle. */
  INSPECTION_WRITE: 'inspection:write',
  /** Perform an inspection (drivers: own vehicles via /me). */
  INSPECTION_PERFORM: 'inspection:perform',
  INCENTIVE_READ: 'incentive:read',
  /** Propose incentives/penalties. */
  INCENTIVE_WRITE: 'incentive:write',
  /** Approve or reject proposals (never one's own). */
  INCENTIVE_APPROVE: 'incentive:approve',
  /** API keys and webhooks. */
  INTEGRATION_MANAGE: 'integration:manage',
  ORDER_READ: 'order:read',
  /** Decide approval requests (never one's own). */
  APPROVAL_DECIDE: 'approval:decide',
  VEHICLE_REQUEST_READ: 'vehicle-request:read',
  /** Ask for a vehicle (booking request). */
  VEHICLE_REQUEST_CREATE: 'vehicle-request:create',
  SETTINGS_WRITE: 'settings:write',
} as const;
export type Permission = (typeof Permission)[keyof typeof Permission];

export const Role = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  COMPANY_ADMIN: 'COMPANY_ADMIN',
  FLEET_MANAGER: 'FLEET_MANAGER',
  DISPATCHER: 'DISPATCHER',
  DRIVER: 'DRIVER',
  EXECUTIVE: 'EXECUTIVE',
  VIEWER: 'VIEWER',
  /** General staff: may only request vehicles and follow their requests. */
  REQUESTER: 'REQUESTER',
} as const;
export type Role = (typeof Role)[keyof typeof Role];

const ALL = Object.values(Permission);
const READ_ONLY = ALL.filter((p) => p.endsWith(':read'));

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  SUPER_ADMIN: ALL,
  COMPANY_ADMIN: ALL.filter((p) => p !== Permission.COMPANY_MANAGE),
  FLEET_MANAGER: [
    ...READ_ONLY.filter((p) => p !== Permission.AUDIT_READ),
    Permission.VEHICLE_WRITE,
    Permission.VEHICLE_DOCUMENT_WRITE,
    Permission.DRIVER_WRITE,
    Permission.TRIP_WRITE,
    Permission.FILE_UPLOAD,
    Permission.GEOFENCE_WRITE,
    Permission.FUEL_WRITE,
    Permission.MAINTENANCE_WRITE,
    Permission.REPAIR_REQUEST,
    Permission.COST_WRITE,
    Permission.SAFETY_WRITE,
    Permission.INCIDENT_REPORT,
    Permission.INSPECTION_WRITE,
    Permission.INSPECTION_PERFORM,
    Permission.INCENTIVE_WRITE,
    Permission.APPROVAL_DECIDE,
    Permission.VEHICLE_REQUEST_CREATE,
  ],
  DISPATCHER: [
    Permission.VEHICLE_READ,
    Permission.DRIVER_READ,
    Permission.TRACKING_READ,
    Permission.TRIP_READ,
    Permission.TRIP_WRITE,
    Permission.FILE_UPLOAD,
    Permission.FUEL_READ,
    Permission.MAINTENANCE_READ,
    Permission.REPAIR_REQUEST,
    Permission.SAFETY_READ,
    Permission.INCIDENT_REPORT,
    Permission.INSPECTION_READ,
    Permission.INSPECTION_PERFORM,
    Permission.ORDER_READ,
    Permission.VEHICLE_REQUEST_READ,
    Permission.VEHICLE_REQUEST_CREATE,
  ],
  DRIVER: [Permission.TRIP_READ, Permission.FILE_UPLOAD, Permission.REPAIR_REQUEST, Permission.INCIDENT_REPORT, Permission.INSPECTION_PERFORM],
  EXECUTIVE: [...READ_ONLY, Permission.VEHICLE_REQUEST_CREATE],
  VIEWER: [Permission.VEHICLE_READ, Permission.DRIVER_READ, Permission.TRACKING_READ, Permission.TRIP_READ, Permission.VEHICLE_REQUEST_CREATE],
  REQUESTER: [Permission.VEHICLE_REQUEST_CREATE],
};

export function permissionsForRoles(roles: readonly string[]): Permission[] {
  const set = new Set<Permission>();
  for (const r of roles) for (const p of ROLE_PERMISSIONS[r as Role] ?? []) set.add(p);
  return [...set];
}
