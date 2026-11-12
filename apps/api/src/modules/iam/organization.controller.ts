import { Body, Controller, ForbiddenException, Get, NotFoundException, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  CreateBranchInput,
  createBranchSchema,
  Permission,
  Role,
  UpdateCompanySettingsInput,
  updateCompanySettingsSchema,
} from '@fms/shared';
import { parseCompanySettings } from '../../common/settings';
import { z } from 'zod';
import type { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, RequirePermissions } from '../../common/auth/decorators';
import { PrismaService } from '../../common/db/prisma.service';
import { ZodPipe } from '../../common/http/zod.pipe';
import { AuthService } from './auth.service';

const createUserSchema = z.object({
  email: z.string().email().transform((v) => v.toLowerCase()),
  fullName: z.string().min(1).max(128),
  password: z.string().min(8),
  roles: z.array(z.nativeEnum(Role)).min(1),
  branchId: z.string().uuid().optional().nullable(),
});
type CreateUserInput = z.infer<typeof createUserSchema>;

const userSelect = {
  id: true,
  email: true,
  fullName: true,
  roles: true,
  branchId: true,
  active: true,
  lastLoginAt: true,
  createdAt: true,
} as const;

@ApiTags('organization')
@ApiBearerAuth()
@Controller()
export class OrganizationController {
  constructor(private readonly db: PrismaService) {}

  @Get('company')
  async company(@CurrentUser() user: AuthUser) {
    const company = await this.db.tenant(user.companyId, (tx) => tx.company.findFirst());
    if (!company) throw new NotFoundException();
    return company;
  }

  /** Effective settings (stored values merged with defaults). */
  @Get('company/settings')
  async settings(@CurrentUser() user: AuthUser) {
    const company = await this.db.tenant(user.companyId, (tx) => tx.company.findFirst({ select: { settings: true } }));
    return parseCompanySettings(company?.settings);
  }

  @Patch('company/settings')
  @RequirePermissions(Permission.SETTINGS_WRITE)
  async updateSettings(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(updateCompanySettingsSchema)) body: UpdateCompanySettingsInput,
  ) {
    return this.db.tenant(user.companyId, async (tx) => {
      const company = await tx.company.findFirst({ select: { settings: true } });
      const current = parseCompanySettings(company?.settings);
      const next = parseCompanySettings({
        ...current,
        telematics: { ...current.telematics, ...body.telematics },
        dispatch: { ...current.dispatch, ...body.dispatch },
        maintenance: { ...current.maintenance, ...body.maintenance },
        safety: { ...current.safety, ...body.safety, weights: { ...current.safety.weights, ...body.safety?.weights } },
        inspections: { ...current.inspections, ...body.inspections },
        incentives: { ...current.incentives, ...body.incentives },
      });
      await tx.company.update({ where: { id: user.companyId }, data: { settings: next } });
      return next;
    });
  }

  @Get('branches')
  @RequirePermissions(Permission.BRANCH_READ)
  branches(@CurrentUser() user: AuthUser) {
    return this.db.tenant(user.companyId, (tx) => tx.branch.findMany({ orderBy: { code: 'asc' } }));
  }

  @Post('branches')
  @RequirePermissions(Permission.BRANCH_WRITE)
  createBranch(@CurrentUser() user: AuthUser, @Body(new ZodPipe(createBranchSchema)) body: CreateBranchInput) {
    return this.db.tenant(user.companyId, (tx) =>
      tx.branch.create({ data: { ...body, companyId: user.companyId } }),
    );
  }

  @Get('departments')
  @RequirePermissions(Permission.BRANCH_READ)
  departments(@CurrentUser() user: AuthUser) {
    return this.db.tenant(user.companyId, (tx) => tx.department.findMany({ orderBy: { code: 'asc' } }));
  }

  @Get('users')
  @RequirePermissions(Permission.USER_READ)
  users(@CurrentUser() user: AuthUser) {
    return this.db.tenant(user.companyId, (tx) =>
      tx.user.findMany({ select: userSelect, orderBy: { fullName: 'asc' } }),
    );
  }

  @Post('users')
  @RequirePermissions(Permission.USER_WRITE)
  async createUser(@CurrentUser() user: AuthUser, @Body(new ZodPipe(createUserSchema)) body: CreateUserInput) {
    if (body.roles.includes(Role.SUPER_ADMIN) && !user.roles.includes(Role.SUPER_ADMIN)) {
      throw new ForbiddenException('Only a super admin can grant SUPER_ADMIN');
    }
    const passwordHash = await AuthService.hashPassword(body.password);
    return this.db.tenant(user.companyId, (tx) =>
      tx.user.create({
        data: {
          companyId: user.companyId,
          email: body.email,
          fullName: body.fullName,
          roles: body.roles,
          branchId: body.branchId ?? null,
          passwordHash,
        },
        select: userSelect,
      }),
    );
  }

  @Get('audit-logs')
  @RequirePermissions(Permission.AUDIT_READ)
  async auditLogs(@CurrentUser() user: AuthUser) {
    const rows = await this.db.tenant(user.companyId, (tx) =>
      tx.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 200 }),
    );
    return rows.map((r) => ({ ...r, id: r.id.toString() }));
  }
}
