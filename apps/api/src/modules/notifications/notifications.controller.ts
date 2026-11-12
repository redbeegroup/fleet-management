import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { RegisterDeviceInput, registerDeviceSchema } from '@fms/shared';
import { PrismaService } from '../../common/db/prisma.service';
import { ZodPipe } from '../../common/http/zod.pipe';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser } from '../../common/auth/decorators';
import { NotificationsService } from './notifications.service';

/** A user's own notifications (no extra permission needed). */
@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly db: PrismaService,
  ) {}

  /** Registers (or re-assigns) a mobile push token for the signed-in user. */
  @Post('devices')
  @HttpCode(200)
  registerDevice(@CurrentUser() user: AuthUser, @Body(new ZodPipe(registerDeviceSchema)) body: RegisterDeviceInput) {
    // Tokens are global: a phone handed to another user moves to that user (system scope).
    return this.db.system((tx) =>
      tx.userDevice.upsert({
        where: { pushToken: body.pushToken },
        create: { ...body, userId: user.userId, companyId: user.companyId },
        update: { userId: user.userId, companyId: user.companyId, platform: body.platform, lastSeenAt: new Date() },
        select: { id: true, platform: true, lastSeenAt: true },
      }),
    );
  }

  @Delete('devices/:token')
  @HttpCode(204)
  async unregisterDevice(@CurrentUser() user: AuthUser, @Param('token') token: string) {
    await this.db.system((tx) => tx.userDevice.deleteMany({ where: { pushToken: token, userId: user.userId } }));
  }

  @Get()
  list(@CurrentUser() user: AuthUser, @Query('unread') unread?: string) {
    return this.notifications.list(user, unread === 'true');
  }

  @Get('unread-count')
  unreadCount(@CurrentUser() user: AuthUser) {
    return this.notifications.unreadCount(user);
  }

  @Post('read-all')
  @HttpCode(200)
  readAll(@CurrentUser() user: AuthUser) {
    return this.notifications.markRead(user);
  }

  @Post(':id/read')
  @HttpCode(200)
  read(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.notifications.markRead(user, id);
  }
}
