import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { CreateCourseInput, CreateTrainingRecordInput, Role, UpdateCourseInput } from '@fms/shared';
import type { AuthUser } from '../../common/auth/auth-user';
import { PrismaService, Tx } from '../../common/db/prisma.service';
import { parseCompanySettings } from '../../common/settings';
import { localDate } from '../../common/time';
import { FilesService } from '../files/files.service';
import { NotificationsService } from '../notifications/notifications.service';
import { addMonths, trainingStatus, TrainingStatus } from './status';

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

@Injectable()
export class TrainingService {
  private readonly logger = new Logger(TrainingService.name);

  constructor(
    private readonly db: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  courses(user: AuthUser) {
    return this.db.tenant(user.companyId, (tx) => tx.trainingCourse.findMany({ orderBy: [{ active: 'desc' }, { name: 'asc' }] }));
  }

  async createCourse(user: AuthUser, input: CreateCourseInput) {
    return this.db.tenant(user.companyId, async (tx) => {
      if (await tx.trainingCourse.findFirst({ where: { code: input.code }, select: { id: true } })) throw new ConflictException(`Course code ${input.code} already exists`);
      return tx.trainingCourse.create({ data: { ...input, companyId: user.companyId } });
    });
  }

  updateCourse(user: AuthUser, id: string, input: UpdateCourseInput) {
    return this.db.tenant(user.companyId, async (tx) => {
      if (!(await tx.trainingCourse.findFirst({ where: { id }, select: { id: true } }))) throw new NotFoundException('Course not found');
      if (input.code && (await tx.trainingCourse.findFirst({ where: { code: input.code, id: { not: id } }, select: { id: true } }))) {
        throw new ConflictException(`Course code ${input.code} already exists`);
      }
      return tx.trainingCourse.update({ where: { id }, data: input });
    });
  }

  /** A driver's records plus their status for every active course. */
  driverTraining(user: AuthUser, driverId: string) {
    return this.db.tenant(user.companyId, async (tx) => {
      if (!(await tx.driver.findFirst({ where: { id: driverId }, select: { id: true } }))) throw new NotFoundException('Driver not found');
      const { today, alertDays } = await this.ctx(tx);
      const [courses, records] = await Promise.all([
        tx.trainingCourse.findMany({ where: { active: true }, orderBy: { name: 'asc' } }),
        tx.driverTraining.findMany({
          where: { driverId },
          include: { course: { select: { id: true, code: true, name: true } } },
          orderBy: { completedAt: 'desc' },
        }),
      ]);
      const status = courses
        .map((c) => {
          const s = trainingStatus(
            records.filter((r) => r.courseId === c.id).map((r) => ({ completedAt: day(r.completedAt)!, expiresAt: day(r.expiresAt) })),
            today,
            alertDays,
          );
          return { courseId: c.id, code: c.code, name: c.name, mandatory: c.mandatory, ...s };
        })
        .filter((s) => s.mandatory || s.status !== 'MISSING');
      return { records, status };
    });
  }

  addRecord(user: AuthUser, driverId: string, input: CreateTrainingRecordInput) {
    return this.db.tenant(user.companyId, async (tx) => {
      if (!(await tx.driver.findFirst({ where: { id: driverId }, select: { id: true } }))) throw new NotFoundException('Driver not found');
      const course = await tx.trainingCourse.findFirst({ where: { id: input.courseId } });
      if (!course) throw new BadRequestException('Course not found');
      await FilesService.assertOwned(tx, input.certificateFileId);
      const expires = input.expiresAt ?? (course.validityMonths ? addMonths(input.completedAt, course.validityMonths) : null);
      if (expires && expires <= input.completedAt) throw new BadRequestException('expiresAt must be after completedAt');
      const { today } = await this.ctx(tx);
      if (input.completedAt > today) throw new BadRequestException('completedAt is in the future');
      return tx.driverTraining.create({
        data: {
          ...input,
          completedAt: new Date(input.completedAt),
          expiresAt: expires ? new Date(expires) : null,
          driverId,
          companyId: user.companyId,
          createdBy: user.userId,
        },
        include: { course: { select: { id: true, code: true, name: true } } },
      });
    });
  }

  removeRecord(user: AuthUser, driverId: string, id: string) {
    return this.db.tenant(user.companyId, async (tx) => {
      const r = await tx.driverTraining.findFirst({ where: { id, driverId } });
      if (!r) throw new NotFoundException('Training record not found');
      await tx.driverTraining.delete({ where: { id } });
    });
  }

  /** Active drivers × mandatory courses (plus any course a driver holds). */
  matrix(user: AuthUser) {
    return this.db.tenant(user.companyId, async (tx) => {
      const { today, alertDays } = await this.ctx(tx);
      const [courses, drivers, records] = await Promise.all([
        tx.trainingCourse.findMany({ where: { active: true }, orderBy: [{ mandatory: 'desc' }, { name: 'asc' }] }),
        tx.driver.findMany({ where: { active: true }, select: { id: true, fullName: true, employeeNo: true }, orderBy: { fullName: 'asc' } }),
        tx.driverTraining.findMany({ select: { driverId: true, courseId: true, completedAt: true, expiresAt: true } }),
      ]);
      const totals: Record<TrainingStatus, number> = { VALID: 0, EXPIRING: 0, EXPIRED: 0, MISSING: 0 };
      const rows = drivers.map((d) => {
        const cells: Record<string, { status: TrainingStatus; expiresAt: string | null }> = {};
        let compliant = true;
        for (const c of courses) {
          const s = trainingStatus(
            records.filter((r) => r.driverId === d.id && r.courseId === c.id).map((r) => ({ completedAt: day(r.completedAt)!, expiresAt: day(r.expiresAt) })),
            today,
            alertDays,
          );
          cells[c.id] = { status: s.status, expiresAt: s.expiresAt };
          if (c.mandatory) {
            totals[s.status] += 1;
            if (s.status === 'EXPIRED' || s.status === 'MISSING') compliant = false;
          }
        }
        return { ...d, compliant, cells };
      });
      return {
        today,
        courses: courses.map((c) => ({ id: c.id, code: c.code, name: c.name, mandatory: c.mandatory, validityMonths: c.validityMonths })),
        drivers: rows,
        summary: { drivers: rows.length, compliant: rows.filter((r) => r.compliant).length, mandatoryCells: totals },
      };
    });
  }

  /** Daily (with compliance-alerts): mandatory certificates expiring or expired, per bucket. */
  async expiryAlerts(now = new Date()): Promise<number> {
    const companies = await this.db.system((tx) => tx.company.findMany({ where: { active: true }, select: { id: true } }));
    let sent = 0;
    for (const c of companies) {
      const items = await this.db.tenant(c.id, async (tx) => {
        const { today, alertDays } = await this.ctx(tx, now);
        const courses = await tx.trainingCourse.findMany({ where: { active: true, mandatory: true, validityMonths: { not: null } } });
        if (!courses.length) return [];
        const drivers = await tx.driver.findMany({ where: { active: true }, select: { id: true, fullName: true, userId: true } });
        const records = await tx.driverTraining.findMany({ where: { courseId: { in: courses.map((x) => x.id) } }, select: { driverId: true, courseId: true, completedAt: true, expiresAt: true } });
        const out: { driver: (typeof drivers)[number]; course: (typeof courses)[number]; status: TrainingStatus; expiresAt: string }[] = [];
        for (const d of drivers)
          for (const co of courses) {
            const rs = records.filter((r) => r.driverId === d.id && r.courseId === co.id);
            if (!rs.length) continue; // never trained: shown in the matrix, not alerted daily
            const s = trainingStatus(rs.map((r) => ({ completedAt: day(r.completedAt)!, expiresAt: day(r.expiresAt) })), today, alertDays);
            if ((s.status === 'EXPIRING' || s.status === 'EXPIRED') && s.expiresAt) out.push({ driver: d, course: co, status: s.status, expiresAt: s.expiresAt });
          }
        return out;
      });
      for (const it of items) {
        const expired = it.status === 'EXPIRED';
        const base = {
          companyId: c.id,
          topic: 'driver.training.expiring',
          severity: expired ? ('critical' as const) : ('warning' as const),
          title: `${it.course.name}: ${it.driver.fullName} — ${expired ? 'expired' : 'expires'} ${it.expiresAt}`,
          body: `${it.driver.fullName}'s ${it.course.name} (${it.course.code}) certificate ${expired ? 'expired' : 'expires'} on ${it.expiresAt}. Schedule a refresher.`,
          data: { driverId: it.driver.id, courseId: it.course.id, link: `/drivers/${it.driver.id}` },
          dedupeKey: `training:${it.driver.id}:${it.course.id}:${it.expiresAt}:${it.status}`,
        };
        sent += await this.notifications.notify({ ...base, roles: [Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.FLEET_MANAGER] });
        if (it.driver.userId) sent += await this.notifications.notify({ ...base, userIds: [it.driver.userId], dedupeKey: `${base.dedupeKey}:self` });
      }
    }
    this.logger.log(`Training expiry alerts: ${sent}`);
    return sent;
  }

  private async ctx(tx: Tx, now = new Date()) {
    const company = await tx.company.findFirstOrThrow({ select: { timezone: true, settings: true } });
    return { today: localDate(now, company.timezone), alertDays: parseCompanySettings(company.settings).incentives.trainingAlertDays };
  }
}
