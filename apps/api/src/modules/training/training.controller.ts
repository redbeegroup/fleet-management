import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CreateCourseInput, createCourseSchema, CreateTrainingRecordInput, createTrainingRecordSchema, Permission, UpdateCourseInput, updateCourseSchema } from '@fms/shared';
import type { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, RequirePermissions } from '../../common/auth/decorators';
import { ZodPipe } from '../../common/http/zod.pipe';
import { TrainingService } from './training.service';

@ApiTags('training')
@ApiBearerAuth()
@Controller()
export class TrainingController {
  constructor(private readonly training: TrainingService) {}

  @Get('training/courses')
  @RequirePermissions(Permission.DRIVER_READ)
  courses(@CurrentUser() user: AuthUser) {
    return this.training.courses(user);
  }

  @Post('training/courses')
  @RequirePermissions(Permission.DRIVER_WRITE)
  createCourse(@CurrentUser() user: AuthUser, @Body(new ZodPipe(createCourseSchema)) body: CreateCourseInput) {
    return this.training.createCourse(user, body);
  }

  @Patch('training/courses/:id')
  @RequirePermissions(Permission.DRIVER_WRITE)
  updateCourse(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(updateCourseSchema)) body: UpdateCourseInput) {
    return this.training.updateCourse(user, id, body);
  }

  @Get('training/matrix')
  @RequirePermissions(Permission.DRIVER_READ)
  matrix(@CurrentUser() user: AuthUser) {
    return this.training.matrix(user);
  }

  @Get('drivers/:id/training')
  @RequirePermissions(Permission.DRIVER_READ)
  driver(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.training.driverTraining(user, id);
  }

  @Post('drivers/:id/training')
  @RequirePermissions(Permission.DRIVER_WRITE)
  add(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(createTrainingRecordSchema)) body: CreateTrainingRecordInput) {
    return this.training.addRecord(user, id, body);
  }

  @Delete('drivers/:id/training/:recordId')
  @HttpCode(204)
  @RequirePermissions(Permission.DRIVER_WRITE)
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('recordId', ParseUUIDPipe) recordId: string) {
    return this.training.removeRecord(user, id, recordId);
  }
}
