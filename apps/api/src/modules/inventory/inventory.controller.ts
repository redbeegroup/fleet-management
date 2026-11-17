import { Body, Controller, Get, Header, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  PartInput,
  partSchema,
  Permission,
  ReceiveStockInput,
  receiveStockSchema,
  StockCountInput,
  stockCountSchema,
  SupplierInput,
  supplierSchema,
  TransferStockInput,
  transferStockSchema,
} from '@fms/shared';
import { z } from 'zod';
import type { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, RequirePermissions } from '../../common/auth/decorators';
import { ZodPipe } from '../../common/http/zod.pipe';
import { InventoryService } from './inventory.service';

const bool = z.enum(['true', 'false']).transform((v) => v === 'true').optional();
const day = z.coerce.date().optional();

@ApiTags('inventory')
@ApiBearerAuth()
@Controller('suppliers')
export class SuppliersController {
  constructor(private readonly inv: InventoryService) {}

  @Get()
  @RequirePermissions(Permission.MAINTENANCE_READ)
  list(@CurrentUser() user: AuthUser, @Query(new ZodPipe(z.object({ kind: z.string().max(20).optional(), active: bool }))) q: { kind?: string; active?: boolean }) {
    return this.inv.suppliers(user, q);
  }

  @Post()
  @RequirePermissions(Permission.INVENTORY_WRITE)
  create(@CurrentUser() user: AuthUser, @Body(new ZodPipe(supplierSchema)) body: SupplierInput) {
    return this.inv.createSupplier(user, body);
  }

  @Patch(':id')
  @RequirePermissions(Permission.INVENTORY_WRITE)
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(supplierSchema.partial())) body: Partial<SupplierInput>) {
    return this.inv.updateSupplier(user, id, body);
  }
}

@ApiTags('inventory')
@ApiBearerAuth()
@Controller('inventory')
export class InventoryController {
  constructor(private readonly inv: InventoryService) {}

  @Get('parts')
  @RequirePermissions(Permission.INVENTORY_READ)
  parts(@CurrentUser() user: AuthUser, @Query(new ZodPipe(z.object({ search: z.string().max(100).optional(), active: bool }))) q: { search?: string; active?: boolean }) {
    return this.inv.parts(user, q);
  }

  @Post('parts')
  @RequirePermissions(Permission.INVENTORY_WRITE)
  createPart(@CurrentUser() user: AuthUser, @Body(new ZodPipe(partSchema)) body: PartInput) {
    return this.inv.createPart(user, body);
  }

  @Patch('parts/:id')
  @RequirePermissions(Permission.INVENTORY_WRITE)
  updatePart(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(partSchema.partial())) body: Partial<PartInput>) {
    return this.inv.updatePart(user, id, body);
  }

  @Post('parts/import')
  @RequirePermissions(Permission.INVENTORY_WRITE)
  importParts(@CurrentUser() user: AuthUser, @Body(new ZodPipe(z.object({ parts: z.array(partSchema).min(1).max(5000) }))) body: { parts: PartInput[] }) {
    return this.inv.importParts(user, body.parts);
  }

  @Get('stock')
  @RequirePermissions(Permission.INVENTORY_READ)
  stock(@CurrentUser() user: AuthUser, @Query(new ZodPipe(z.object({ branchId: z.string().uuid().optional(), search: z.string().max(100).optional(), belowMin: bool }))) q: { branchId?: string; search?: string; belowMin?: boolean }) {
    return this.inv.stock(user, q);
  }

  @Patch('stock/:id')
  @RequirePermissions(Permission.INVENTORY_WRITE)
  updateStock(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(z.object({ minQty: z.number().min(0).nullable().optional(), bin: z.string().max(40).nullable().optional() }))) body: { minQty?: number | null; bin?: string | null }) {
    return this.inv.updateStock(user, id, body);
  }

  @Get('movements')
  @RequirePermissions(Permission.INVENTORY_READ)
  movements(
    @CurrentUser() user: AuthUser,
    @Query(new ZodPipe(z.object({ partId: z.string().uuid().optional(), branchId: z.string().uuid().optional(), kind: z.string().max(20).optional(), workOrderId: z.string().uuid().optional(), from: day, to: day, page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(200).default(50) })))
    q: { partId?: string; branchId?: string; kind?: string; workOrderId?: string; from?: Date; to?: Date; page: number; pageSize: number },
  ) {
    return this.inv.movements(user, q);
  }

  @Get('movements.csv')
  @RequirePermissions(Permission.INVENTORY_READ)
  @Header('Content-Type', 'text/csv; charset=utf-8')
  movementsCsv(@CurrentUser() user: AuthUser, @Query(new ZodPipe(z.object({ branchId: z.string().uuid().optional(), from: day, to: day }))) q: { branchId?: string; from?: Date; to?: Date }) {
    return this.inv.movementsCsv(user, q);
  }

  @Post('receipts')
  @RequirePermissions(Permission.INVENTORY_WRITE)
  receive(@CurrentUser() user: AuthUser, @Body(new ZodPipe(receiveStockSchema)) body: ReceiveStockInput) {
    return this.inv.receive(user, body);
  }

  @Post('transfers')
  @RequirePermissions(Permission.INVENTORY_WRITE)
  transfer(@CurrentUser() user: AuthUser, @Body(new ZodPipe(transferStockSchema)) body: TransferStockInput) {
    return this.inv.transfer(user, body);
  }

  @Post('counts')
  @RequirePermissions(Permission.INVENTORY_WRITE)
  count(@CurrentUser() user: AuthUser, @Body(new ZodPipe(stockCountSchema)) body: StockCountInput) {
    return this.inv.stockCount(user, body);
  }
}
