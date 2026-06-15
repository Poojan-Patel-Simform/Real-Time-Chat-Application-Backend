import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { NotificationService } from './notification.service.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { JwtPayload } from '../common/guards/jwt-auth.guard.js';

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  /**
   * GET /notifications/count
   * Returns the total number of unread messages for the logged-in user.
   */
  @Get('count')
  async getCount(@CurrentUser() user: JwtPayload): Promise<{ count: number }> {
    const count = await this.notificationService.getUnreadCount(user.sub);
    return { count };
  }

  /**
   * POST /notifications/read-all
   * Marks all unread messages as READ for the logged-in user.
   * Returns the number of messages updated.
   */
  @Post('read-all')
  @HttpCode(HttpStatus.OK)
  async markAllRead(
    @CurrentUser() user: JwtPayload,
  ): Promise<{ updated: number }> {
    const updated = await this.notificationService.markAllRead(user.sub);
    return { updated };
  }
}
