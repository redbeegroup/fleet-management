import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CreateDriverInput, Paginated, PaginationInput } from '@fms/shared';
import type { AuthUser } from '../../common/auth/auth-user';
import { PrismaService } from '../../common/db/prisma.service';

@Injectable()
export class DriversService {
  constructor(private readonly db: PrismaService) {}

  list(user: AuthUser, q: PaginationInput): Promise<Paginated<unknown>> {
    const where: Prisma.DriverWhereInput = q.search
      ? {
          OR: [
            { fullName: { contains: q.search, mode: 'insensitive' } },
            { employeeNo: { contains: q.search, mode: 'insensitive' } },
          ],
        }
      : {};
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
          licenses: { orderBy: { expiresAt: 'desc' } },
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
}
