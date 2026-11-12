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

    // Demo trips around "now" so the dispatch board has content.
    if (!(await tx.trip.count({ where: { companyId: company.id } }))) {
      const H = 3_600_000;
      const now = Date.now();
      const vs = await tx.vehicle.findMany({ where: { companyId: company.id }, orderBy: { plateNumber: 'asc' } });
      const ds = await tx.driver.findMany({ where: { companyId: company.id }, orderBy: { employeeNo: 'asc' } });
      const plate = (p: string) => vs.find((v) => v.plateNumber === p)!.id;
      const demo = [
        { from: 'Yangon HQ', to: 'Bago distributor', s: -7, e: -4, v: 'YGN-1A-1001', d: 0, status: 'COMPLETED' as const },
        { from: 'Yangon HQ', to: 'Thilawa port', s: -1, e: 2, v: 'YGN-2B-2002', d: 1, status: 'ONGOING' as const },
        { from: 'Yangon HQ', to: 'Hlaing Tharyar warehouse', s: 3, e: 6, v: 'YGN-1A-1001', d: 0, status: 'ASSIGNED' as const },
        { from: 'Mandalay branch', to: 'Pyin Oo Lwin', s: 1, e: 5, v: 'MDY-4D-4004', d: 0, status: 'PLANNED' as const },
        { from: 'Yangon HQ', to: 'Insein market', s: 5, e: 7, v: null, d: null, status: 'PLANNED' as const },
      ];
      for (const [i, t] of demo.entries()) {
        const assigned = t.status !== 'PLANNED';
        const start = new Date(now + t.s * H);
        await tx.trip.create({
          data: {
            companyId: company.id,
            tripNo: `TRP-${start.getUTCFullYear()}-${String(i + 1).padStart(6, '0')}`,
            originName: t.from,
            destinationName: t.to,
            plannedStart: start,
            plannedEnd: new Date(now + t.e * H),
            status: t.status,
            vehicleId: assigned && t.v ? plate(t.v) : null,
            driverId: assigned && t.d !== null ? ds[t.d].id : null,
            actualStart: t.status === 'ONGOING' || t.status === 'COMPLETED' ? start : null,
            actualEnd: t.status === 'COMPLETED' ? new Date(now + t.e * H) : null,
            gpsDistanceKm: t.status === 'COMPLETED' ? 74.3 : null,
            purpose: 'Delivery',
            statusHistory: { create: { companyId: company.id, toStatus: t.status, note: 'Seeded' } },
          },
        });
        if (t.status === 'ONGOING' && t.v) {
          await tx.vehicle.update({ where: { id: plate(t.v) }, data: { status: 'OPERATING' } });
        }
      }
      await tx.companyCounter.upsert({
        where: { companyId_key: { companyId: company.id, key: `trip:${new Date().getUTCFullYear()}` } },
        update: {},
        create: { companyId: company.id, key: `trip:${new Date().getUTCFullYear()}`, value: demo.length },
      });
    }

    // Demo fuel history (60 days), PM plans, a completed work order and an open repair request.
    if (!(await tx.fuelRecord.count({ where: { companyId: company.id } }))) {
      const DAY = 86_400_000;
      const vs = await tx.vehicle.findMany({ where: { companyId: company.id, plateNumber: { in: ['YGN-1A-1001', 'YGN-2B-2002', 'YGN-3C-3003', 'MDY-4D-4004'] } } });
      const profile: Record<string, { kmpl: number; daily: number; tank: number }> = {
        'YGN-1A-1001': { kmpl: 6.5, daily: 160, tank: 100 },
        'YGN-2B-2002': { kmpl: 9.5, daily: 120, tank: 70 },
        'YGN-3C-3003': { kmpl: 10.5, daily: 90, tank: 80 },
        'MDY-4D-4004': { kmpl: 5.8, daily: 180, tank: 120 },
      };
      for (const v of vs) {
        const p = profile[v.plateNumber];
        await tx.vehicle.update({ where: { id: v.id }, data: { tankCapacityL: p.tank, fuelType: 'Diesel' } });
        let odo = Number(v.odometerKm) - p.daily * 60;
        const fills: { filledAt: Date; odometerKm: number; litres: number; unitPrice: number; totalCost: number }[] = [];
        for (let d = 60; d > 0; d -= 4) {
          const km = p.daily * 4;
          odo += km;
          // ±8% noise; one thirsty tank for the first truck to show the anomaly flag
          const thirsty = v.plateNumber === 'YGN-1A-1001' && d === 20;
          const litres = Math.round((km / (p.kmpl * (thirsty ? 0.55 : 0.92 + ((d * 7) % 16) / 100))) * 10) / 10;
          fills.push({ filledAt: new Date(Date.now() - d * DAY), odometerKm: odo, litres, unitPrice: 2600, totalCost: Math.round(litres * 2600) });
        }
        // Full-to-full efficiency, computed the same way as the API does.
        let prevOdo: number | null = null;
        for (const f of fills) {
          const kmPerLitre = prevOdo === null ? null : Math.round(((f.odometerKm - prevOdo) / f.litres) * 100) / 100;
          await tx.fuelRecord.create({
            data: {
              companyId: company.id,
              vehicleId: v.id,
              ...f,
              fuelType: 'Diesel',
              station: 'Max Energy',
              paymentMethod: 'FUEL_CARD',
              distanceKm: prevOdo === null ? null : f.odometerKm - prevOdo,
              kmPerLitre,
              flags: kmPerLitre !== null && kmPerLitre < p.kmpl * 0.7 ? ['LOW_EFFICIENCY'] : [],
            },
          });
          prevOdo = f.odometerKm;
        }
        await tx.maintenancePlan.createMany({
          data: [
            { companyId: company.id, vehicleId: v.id, name: 'Engine oil & filter', intervalKm: 5000, lastDoneAt: new Date(Date.now() - 40 * DAY), lastDoneOdometerKm: Number(v.odometerKm) - (v.plateNumber === 'MDY-4D-4004' ? 5200 : 3000) },
            { companyId: company.id, vehicleId: v.id, name: 'Annual inspection', intervalDays: 365, lastDoneAt: new Date(Date.now() - (v.plateNumber === 'YGN-2B-2002' ? 360 : 120) * DAY) },
          ],
        });
      }
      const truck = vs.find((v) => v.plateNumber === 'YGN-3C-3003')!;
      const year = new Date().getUTCFullYear();
      await tx.workOrder.create({
        data: {
          companyId: company.id,
          woNo: `WO-${year}-000001`,
          vehicleId: truck.id,
          type: 'CORRECTIVE',
          status: 'COMPLETED',
          title: 'Replace front brake pads',
          workshop: 'Internal workshop',
          openedAt: new Date(Date.now() - 12 * DAY),
          startedAt: new Date(Date.now() - 12 * DAY),
          completedAt: new Date(Date.now() - 11 * DAY),
          resolution: 'Pads and discs replaced',
          totalCost: 185_000,
          lines: {
            create: [
              { companyId: company.id, kind: 'PART', description: 'Brake pad set', quantity: 1, unitCost: 125_000, total: 125_000 },
              { companyId: company.id, kind: 'LABOUR', description: 'Mechanic (h)', quantity: 4, unitCost: 15_000, total: 60_000 },
            ],
          },
        },
      });
      await tx.vehicleStatusEvent.createMany({
        data: [
          { companyId: company.id, vehicleId: truck.id, fromStatus: 'AVAILABLE', toStatus: 'UNDER_REPAIR', reason: `WO-${year}-000001`, createdAt: new Date(Date.now() - 12 * DAY) },
          { companyId: company.id, vehicleId: truck.id, fromStatus: 'UNDER_REPAIR', toStatus: 'AVAILABLE', reason: `WO-${year}-000001 completed`, createdAt: new Date(Date.now() - 11 * DAY) },
        ],
      });
      await tx.companyCounter.upsert({
        where: { companyId_key: { companyId: company.id, key: `wo:${year}` } },
        update: {},
        create: { companyId: company.id, key: `wo:${year}`, value: 1 },
      });
      await tx.repairRequest.create({
        data: { companyId: company.id, vehicleId: vs.find((v) => v.plateNumber === 'YGN-2B-2002')!.id, description: 'Air conditioning not cooling', severity: 'MEDIUM', reportedBy: driverUser.id },
      });
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
