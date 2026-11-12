import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CreateDriverInput, CreateDriverLicenseInput, Paginated, PaginationInput, UpdateDriverInput } from '@fms/shared';
import type { AuthUser } from '../../common/auth/auth-user';
import { PrismaService, Tx } from '../../common/db/prisma.service';
import { FilesService } from '../files/files.service';

@Injectable()
export class DriversService {
  constructor(private readonly db: PrismaService) {}

  list(user: AuthUser, q: PaginationInput & { active?: boolean }): Promise<Paginated<unknown>> {
    const where: Prisma.DriverWhereInput = {
      ...(q.active !== undefined && { active: q.active }),
      ...(q.search && {
        OR: [
          { fullName: { contains: q.search, mode: 'insensitive' } },
          { employeeNo: { contains: q.search, mode: 'insensitive' } },
        ],
      }),
    };
    return this.db.tenant(user.companyId, async (tx) => {
      const [items, total] = await Promise.all([
        tx.driver.findMany({
          where,
          include: {
            licenses: { orderBy: { expiresAt: 'desc' }, take: 1 },
            assignments: { where: { endAt: null }, include: { vehicle: { select: { id: true, plateNumber: true } } } },
          },
          orderBy: { fullName: 'asc' },
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
        }),
        tx.driver.count({ where }),
      ]);
      return { items, total, page: q.page, pageSize: q.pageSize };
    });
  }

  async get(user: AuthUser, id: string) {
    const driver = await this.db.tenant(user.companyId, (tx) =>
      tx.driver.findFirst({
        where: { id },
        include: {
          licenses: {
            orderBy: { expiresAt: 'desc' },
            include: { file: { select: { id: true, filename: true, contentType: true } } },
          },
          user: { select: { id: true, email: true } },
          assignments: {
            orderBy: { startAt: 'desc' },
            take: 50,
            include: { vehicle: { select: { id: true, plateNumber: true } } },
          },
        },
      }),
    );
    if (!driver) throw new NotFoundException('Driver not found');
    return driver;
  }

  create(user: AuthUser, input: CreateDriverInput) {
    const { licenseNumber, licenseClass, licenseExpiresAt, ...driver } = input;
    return this.db.tenant(user.companyId, (tx) =>
      tx.driver.create({
        data: {
          ...driver,
          companyId: user.companyId,
          ...(licenseNumber && {
            licenses: {
              create: {
                companyId: user.companyId,
                number: licenseNumber,
                licenseClass: licenseClass ?? 'UNSPECIFIED',
                expiresAt: licenseExpiresAt ?? null,
              },
            },
          }),
        },
        include: { licenses: true },
      }),
    );
  }

  expiringLicenses(user: AuthUser, days: number) {
    const until = new Date(Date.now() + days * 86_400_000);
    return this.db.tenant(user.companyId, (tx) =>
      tx.driverLicense.findMany({
        where: { expiresAt: { lte: until }, driver: { active: true } },
        include: { driver: { select: { id: true, fullName: true, employeeNo: true } } },
        orderBy: { expiresAt: 'asc' },
      }),
    );
  }

  update(user: AuthUser, id: string, input: UpdateDriverInput) {
    return this.db.tenant(user.companyId, async (tx) => {
      await this.mustExist(tx, id);
      if (input.userId) {
        const linked = await tx.user.findFirst({ where: { id: input.userId }, select: { id: true } });
        if (!linked) throw new BadRequestException('userId does not exist');
      }
      if (input.active === false) {
        // A deactivated driver releases any vehicle they hold.
        await tx.vehicleAssignment.updateMany({ where: { driverId: id, endAt: null }, data: { endAt: new Date() } });
      }
      return tx.driver.update({ where: { id }, data: input });
    });
  }

  addLicense(user: AuthUser, driverId: string, input: CreateDriverLicenseInput) {
    return this.db.tenant(user.companyId, async (tx) => {
      await this.mustExist(tx, driverId);
      await FilesService.assertOwned(tx, input.fileId);
      return tx.driverLicense.create({ data: { ...input, driverId, companyId: user.companyId } });
    });
  }

  removeLicense(user: AuthUser, driverId: string, licenseId: string) {
    return this.db.tenant(user.companyId, async (tx) => {
      const { count } = await tx.driverLicense.deleteMany({ where: { id: licenseId, driverId } });
      if (!count) throw new NotFoundException('Licence not found');
    });
  }

  private async mustExist(tx: Tx, id: string) {
    const driver = await tx.driver.findFirst({ where: { id } });
    if (!driver) throw new NotFoundException('Driver not found');
    return driver;
  }
}
