import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { UsersService } from './users.service.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { JwtPayload } from '../common/guards/jwt-auth.guard.js';

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  /** GET /api/users — list all users (except self) with online + block status */
  @Get()
  getUsers(@CurrentUser() user: JwtPayload) {
    return this.usersService.getUsers(user.sub);
  }

  /** POST /api/users/:userId/block — block a user */
  @Post(':userId/block')
  @HttpCode(HttpStatus.CREATED)
  blockUser(
    @CurrentUser() user: JwtPayload,
    @Param('userId', ParseUUIDPipe) targetId: string,
  ) {
    return this.usersService.blockUser(user.sub, targetId);
  }

  /** DELETE /api/users/:userId/block — unblock a user */
  @Delete(':userId/block')
  @HttpCode(HttpStatus.OK)
  unblockUser(
    @CurrentUser() user: JwtPayload,
    @Param('userId', ParseUUIDPipe) targetId: string,
  ) {
    return this.usersService.unblockUser(user.sub, targetId);
  }
}
