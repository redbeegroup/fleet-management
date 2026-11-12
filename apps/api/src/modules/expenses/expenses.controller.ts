import { BadRequestException, Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CreateExpenseInput, createExpenseSchema, ExpenseCategory, paginationSchema, Permission } from '@fms/shared';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import type { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, RequirePermissions } from '../../common/auth/decorators';
import { PrismaService } from '../../common/db/prisma.service';
import { ZodPipe } from '../../common/http/zod.pipe';
import { FilesService } from '../files/files.service';

const listSchema = paginationSchema.extend({
  vehicleId: z.string().uuid().optional(),
  category: z.nativeEnum(ExpenseCategory).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

/** Operating expenses other than fuel and maintenance. */
@ApiTags('expenses')
@ApiBearerAuth()
@Controller('expenses')
export class ExpensesController {
  constructor(private readonly db: PrismaService) {}

  @Get()
  @RequirePermissions(Permission.COST_READ)
  list(@CurrentUser() user: AuthUser, @Query(new ZodPipe(listSchema)) q: z.infer<typeof listSchema>) {
    const where: Prisma.VehicleExpenseWhereInput = {
      ...(q.vehicleId && { vehicleId: q.vehicleId }),
      ...(q.category && { category: q.category }),
      ...((q.from || q.to) && { incurredAt: { ...(q.from && { gte: q.from }), ...(q.to && { lt: q.to }) } }),
    };
    return this.db.tenant(user.companyId, async (tx) => {
      const [items, total] = await Promise.all([
        tx.vehicleExpense.findMany({
          where,
          include: { vehicle: { select: { id: true, plateNumber: true } } },
          orderBy: { incurredAt: 'desc' },
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
        }),
        tx.vehicleExpense.count({ where }),
      ]);
      return { items, total, page: q.page, pageSize: q.pageSize };
    });
  }

  @Post()
  @RequirePermissions(Permission.COST_WRITE)
  create(@CurrentUser() user: AuthUser, @Body(new ZodPipe(createExpenseSchema)) body: CreateExpenseInput) {
    return this.db.tenant(user.companyId, async (tx) => {
      if (!(await tx.vehicle.findFirst({ where: { id: body.vehicleId, deletedAt: null }, select: { id: true } }))) {
        throw new BadRequestException('Vehicle not found');
      }
      if (body.tripId && !(await tx.trip.findFirst({ where: { id: body.tripId, vehicleId: body.vehicleId }, select: { id: true } }))) {
        throw new BadRequestException('Trip not found for this vehicle');
      }
      await FilesService.assertOwned(tx, body.receiptFileId);
      return tx.vehicleExpense.create({
        data: { ...body, companyId: user.companyId, createdBy: user.userId },
        include: { vehicle: { select: { id: true, plateNumber: true } } },
      });
    });
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(Permission.COST_WRITE)
  async remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const { count } = await this.db.tenant(user.companyId, (tx) => tx.vehicleExpense.deleteMany({ where: { id } }));
    if (!count) throw new NotFoundException('Expense not found');
  }
}
