import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UsersService } from './users.service.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { JwtPayload } from '../common/guards/jwt-auth.guard.js';
import { GetUsersDto } from './dto/get-users.dto.js';

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  /**
   * GET /api/users
   * Query params:
   *   page          (default 1)
   *   limit         (default 20, max 50)
   *   search        — case-insensitive match on username / display_name
   *   isOnline      — true | false
   *   blockedByMe   — true | false (users I have blocked)
   *   blockedByReceiver — true | false (users who have blocked me)
   */
  @Get()
  getUsers(@CurrentUser() user: JwtPayload, @Query() query: GetUsersDto) {
    return this.usersService.getUsers(user.sub, query);
  }

  /** GET /api/users/me — get the logged-in user's profile */
  @Get('current/me')
  getMe(@CurrentUser() user: JwtPayload) {
    return this.usersService.getUserById(user.sub);
  }

  @Get(':id')
  getUserById(@Param() params: { id: string }) {
    return this.usersService.getUserById(params.id);
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
