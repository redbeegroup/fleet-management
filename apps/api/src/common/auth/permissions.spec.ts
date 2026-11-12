import { Permission, permissionsForRoles } from '@fms/shared';

describe('role → permission mapping', () => {
  it('gives drivers trip read, uploads, repair requests and incident reports only', () => {
    expect(permissionsForRoles(['DRIVER']).sort()).toEqual([Permission.FILE_UPLOAD, Permission.INCIDENT_REPORT, Permission.REPAIR_REQUEST, Permission.TRIP_READ].sort());
  });
  it('merges multiple roles', () => {
    const perms = permissionsForRoles(['DRIVER', 'VIEWER']);
    expect(perms).toContain(Permission.VEHICLE_READ);
    expect(perms).not.toContain(Permission.VEHICLE_WRITE);
  });
  it('ignores unknown roles', () => {
    expect(permissionsForRoles(['NOPE'])).toEqual([]);
  });
  it('keeps company:manage for super admins only', () => {
    expect(permissionsForRoles(['COMPANY_ADMIN'])).not.toContain(Permission.COMPANY_MANAGE);
    expect(permissionsForRoles(['SUPER_ADMIN'])).toContain(Permission.COMPANY_MANAGE);
  });
});
