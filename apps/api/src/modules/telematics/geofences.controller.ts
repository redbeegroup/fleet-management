import { Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { GeofenceInput, geofenceSchema, Permission } from '@fms/shared';
import type { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, RequirePermissions } from '../../common/auth/decorators';
import { PrismaService } from '../../common/db/prisma.service';
import { ZodPipe } from '../../common/http/zod.pipe';

function normalize(g: GeofenceInput) {
  return g.shape === 'CIRCLE'
    ? { ...g, polygon: undefined }
    : { ...g, centerLat: null, centerLng: null, radiusM: null, polygon: g.polygon ?? undefined };
}

@ApiTags('geofences')
@ApiBearerAuth()
@Controller('geofences')
export class GeofencesController {
  constructor(private readonly db: PrismaService) {}

  @Get()
  @RequirePermissions(Permission.TRACKING_READ)
  list(@CurrentUser() user: AuthUser) {
    return this.db.tenant(user.companyId, (tx) => tx.geofence.findMany({ orderBy: { name: 'asc' } }));
  }

  @Post()
  @RequirePermissions(Permission.GEOFENCE_WRITE)
  create(@CurrentUser() user: AuthUser, @Body(new ZodPipe(geofenceSchema)) body: GeofenceInput) {
    return this.db.tenant(user.companyId, (tx) => tx.geofence.create({ data: { ...normalize(body), companyId: user.companyId } }));
  }

  @Patch(':id')
  @RequirePermissions(Permission.GEOFENCE_WRITE)
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(geofenceSchema)) body: GeofenceInput,
  ) {
    return this.db.tenant(user.companyId, async (tx) => {
      if (!(await tx.geofence.findFirst({ where: { id } }))) throw new NotFoundException('Geofence not found');
      return tx.geofence.update({ where: { id }, data: normalize(body) });
    });
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(Permission.GEOFENCE_WRITE)
  async remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const { count } = await this.db.tenant(user.companyId, (tx) => tx.geofence.deleteMany({ where: { id } }));
    if (!count) throw new NotFoundException('Geofence not found');
  }
}
