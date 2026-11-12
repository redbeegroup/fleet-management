/* eslint-disable no-console */
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

/**
 * Idempotent demo seed for local/Docker testing. NEVER run against production
 * (guarded by SEED_ALLOW / NODE_ENV).
 */
const prisma = new PrismaClient();

async function main() {
  if (process.env.NODE_ENV === 'production' && process.env.SEED_ALLOW !== 'true') {
    throw new Error('Refusing to seed in production (set SEED_ALLOW=true to override)');
  }
  const adminEmail = (process.env.SEED_ADMIN_EMAIL ?? 'admin@fms.local').toLowerCase();
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe123!';

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;

    const company = await tx.company.upsert({
      where: { code: 'DEMO' },
      update: {},
      create: { code: 'DEMO', name: 'Demo Fleet Company' },
    });

    const branches = await Promise.all(
      [
        { code: 'YGN', name: 'Yangon HQ', latitude: 16.8409, longitude: 96.1735 },
        { code: 'MDY', name: 'Mandalay Branch', latitude: 21.9588, longitude: 96.0891 },
      ].map((b) =>
        tx.branch.upsert({
          where: { companyId_code: { companyId: company.id, code: b.code } },
          update: {},
          create: { ...b, companyId: company.id },
        }),
      ),
    );

    for (const d of [
      { code: 'DIST', name: 'Distribution' },
      { code: 'ADMIN', name: 'Administration' },
    ]) {
      await tx.department.upsert({
        where: { companyId_code: { companyId: company.id, code: d.code } },
        update: {},
        create: { ...d, companyId: company.id },
      });
    }

    const passwordHash = await argon2.hash(adminPassword, { type: argon2.argon2id });
    await tx.user.upsert({
      where: { email: adminEmail },
      update: {},
      create: {
        companyId: company.id,
        email: adminEmail,
        fullName: 'System Administrator',
        passwordHash,
        roles: ['SUPER_ADMIN'],
      },
    });
    await tx.user.upsert({
      where: { email: 'manager@fms.local' },
      update: {},
      create: {
        companyId: company.id,
        branchId: branches[0].id,
        email: 'manager@fms.local',
        fullName: 'Fleet Manager',
        passwordHash,
        roles: ['FLEET_MANAGER'],
      },
    });

    const vehicles = [
      { plateNumber: 'YGN-1A-1001', make: 'Isuzu', model: 'NPR', vehicleClass: 'TRUCK', capacityKg: 4500, gpsDeviceId: 'WT-0001' },
      { plateNumber: 'YGN-2B-2002', make: 'Toyota', model: 'Hiace', vehicleClass: 'VAN', capacityKg: 1200, gpsDeviceId: 'WT-0002' },
      { plateNumber: 'YGN-3C-3003', make: 'Toyota', model: 'Hilux', vehicleClass: 'PICKUP', capacityKg: 1000, gpsDeviceId: 'WT-0003' },
      { plateNumber: 'MDY-4D-4004', make: 'Hino', model: '300', vehicleClass: 'TRUCK', capacityKg: 5000, gpsDeviceId: 'WT-0004' },
      { plateNumber: 'YGN-5E-5005', make: 'Suzuki', model: 'Ertiga', vehicleClass: 'CAR', capacityKg: null, gpsDeviceId: null },
    ] as const;

    for (const [i, v] of vehicles.entries()) {
      const branch = v.plateNumber.startsWith('MDY') ? branches[1] : branches[0];
      const vehicle = await tx.vehicle.upsert({
        where: { companyId_plateNumber: { companyId: company.id, plateNumber: v.plateNumber } },
        update: {},
        create: { ...v, companyId: company.id, branchId: branch.id, year: 2019 + i, odometerKm: 25_000 * (i + 1) },
      });
      if (!(await tx.vehicleStatusEvent.count({ where: { vehicleId: vehicle.id } }))) {
        await tx.vehicleStatusEvent.create({
          data: { companyId: company.id, vehicleId: vehicle.id, toStatus: vehicle.status, reason: 'Registered' },
        });
      }
      const existingDocs = await tx.vehicleDocument.count({ where: { vehicleId: vehicle.id } });
      if (!existingDocs) {
        await tx.vehicleDocument.createMany({
          data: [
            {
              companyId: company.id,
              vehicleId: vehicle.id,
              type: 'INSURANCE',
              number: `INS-${1000 + i}`,
              expiresAt: new Date(Date.now() + (i * 20 - 5) * 86_400_000),
            },
            {
              companyId: company.id,
              vehicleId: vehicle.id,
              type: 'ROAD_TAX',
              number: `RT-${2000 + i}`,
              expiresAt: new Date(Date.now() + (90 + i * 30) * 86_400_000),
            },
          ],
        });
      }
    }

    if (!(await tx.geofence.count({ where: { companyId: company.id } }))) {
      await tx.geofence.createMany({
        data: [
          {
            companyId: company.id,
            name: 'Yangon HQ yard',
            category: 'BRANCH',
            shape: 'CIRCLE',
            centerLat: 16.8409,
            centerLng: 96.1735,
            radiusM: 1500,
            alertOnEnter: true,
            alertOnExit: true,
          },
          {
            companyId: company.id,
            name: 'North warehouse',
            category: 'WAREHOUSE',
            shape: 'POLYGON',
            polygon: [
              [96.16, 16.865],
              [96.19, 16.865],
              [96.19, 16.885],
              [96.16, 16.885],
            ],
            alertOnEnter: true,
          },
        ],
      });
    }

    // Driver login for the mobile app, linked to the first driver below.
    const driverUser = await tx.user.upsert({
      where: { email: 'driver@fms.local' },
      update: {},
      create: {
        companyId: company.id,
        branchId: branches[0].id,
        email: 'driver@fms.local',
        fullName: 'Aung Aung',
        passwordHash,
        roles: ['DRIVER'],
      },
    });

    for (const [i, name] of ['Aung Aung', 'Kyaw Kyaw', 'Thida'].entries()) {
      const employeeNo = `DRV-${String(i + 1).padStart(3, '0')}`;
      const existing = await tx.driver.findUnique({
        where: { companyId_employeeNo: { companyId: company.id, employeeNo } },
      });
      if (!existing) {
        await tx.driver.create({
          data: {
            companyId: company.id,
            branchId: branches[0].id,
            employeeNo,
            fullName: name,
            userId: i === 0 ? driverUser.id : null,
            phone: `+95 9 4500 ${1000 + i}`,
            licenses: {
              create: {
                companyId: company.id,
                number: `LIC-${5000 + i}`,
                licenseClass: i === 0 ? 'E' : 'B',
                expiresAt: new Date(Date.now() + (i * 200 + 10) * 86_400_000),
              },
            },
          },
        });
      }
    }
  });

  console.log(`Seed complete. Admin login: ${adminEmail}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
