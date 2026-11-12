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
  fileKey: z.string().max(512).optional().nullable(),
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
