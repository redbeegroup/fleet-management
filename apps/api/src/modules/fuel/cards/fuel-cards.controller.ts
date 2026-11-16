import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { FuelCardInput, fuelCardSchema, paginationSchema, Permission, ReviewCardTxnInput, reviewCardTxnSchema, updateFuelCardSchema } from '@fms/shared';
import { z } from 'zod';
import type { AuthUser } from '../../../common/auth/auth-user';
import { CurrentUser, RequirePermissions } from '../../../common/auth/decorators';
import { ZodPipe } from '../../../common/http/zod.pipe';
import { FuelCardsService } from './fuel-cards.service';

const txnQuery = paginationSchema.extend({
  status: z.enum(['MATCHED', 'MISMATCH', 'CARD_ONLY', 'ACCEPTED', 'NON_FUEL']).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

@ApiTags('fuel')
@ApiBearerAuth()
@Controller('fuel')
export class FuelCardsController {
  constructor(private readonly cards: FuelCardsService) {}

  @Get('cards')
  @RequirePermissions(Permission.FUEL_READ)
  list(@CurrentUser() user: AuthUser) {
    return this.cards.listCards(user);
  }

  @Post('cards')
  @RequirePermissions(Permission.FUEL_WRITE)
  create(@CurrentUser() user: AuthUser, @Body(new ZodPipe(fuelCardSchema)) body: FuelCardInput) {
    return this.cards.createCard(user, body);
  }

  @Patch('cards/:id')
  @RequirePermissions(Permission.FUEL_WRITE)
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(updateFuelCardSchema)) body: Partial<FuelCardInput>) {
    return this.cards.updateCard(user, id, body);
  }

  /** multipart: file (.csv/.xlsx), mapping (JSON, optional for the first look), commit ('true' to import). */
  @Post('card-statements')
  @RequirePermissions(Permission.FUEL_WRITE)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024, files: 1 } }))
  importStatement(@CurrentUser() user: AuthUser, @UploadedFile() file: { buffer: Buffer; originalname: string; size: number } | undefined, @Body() body: { mapping?: string; commit?: string }) {
    return this.cards.importStatement(user, file, body.mapping ?? '', body.commit === 'true');
  }

  @Post('card-sync')
  @RequirePermissions(Permission.FUEL_WRITE)
  sync(@CurrentUser() user: AuthUser) {
    return this.cards.syncNow(user);
  }

  @Get('card-imports')
  @RequirePermissions(Permission.FUEL_READ)
  imports(@CurrentUser() user: AuthUser) {
    return this.cards.imports(user);
  }

  @Get('card-transactions')
  @RequirePermissions(Permission.FUEL_READ)
  txns(@CurrentUser() user: AuthUser, @Query(new ZodPipe(txnQuery)) q: z.infer<typeof txnQuery>) {
    return this.cards.listTxns(user, q);
  }

  @Post('card-transactions/:id/review')
  @RequirePermissions(Permission.FUEL_WRITE)
  review(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(reviewCardTxnSchema)) body: ReviewCardTxnInput) {
    return this.cards.review(user, id, body);
  }
}
