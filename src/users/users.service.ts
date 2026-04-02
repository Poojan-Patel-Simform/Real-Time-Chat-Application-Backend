import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service.js';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── List all users with online status and block flags ─────────────────────

  async getUsers(myId: string) {
    const users = await this.prisma.user.findMany({
      where: {
        id: { not: myId },
        is_profile_complete: true,
      },
      select: {
        id: true,
        profile: {
          select: {
            username: true,
            display_name: true,
            avatar_url: true,
          },
        },
        // Count presence rows — > 0 means online
        presence: { select: { id: true } },
        // Rows where I am the blocker targeting this user
        blocked_by_me: {
          where: { blocker_id: myId },
          select: { id: true },
        },
        // Rows where this user has blocked me
        blocked_by_receiver: {
          where: { blocked_id: myId },
          select: { id: true },
        },
      },
    });

    return users.map((u) => ({
      id: u.id,
      username: u.profile?.username ?? null,
      display_name: u.profile?.display_name ?? null,
      avatar_url: u.profile?.avatar_url ?? null,
      is_online: u.presence.length > 0,
      is_blocked_by_me: u.blocked_by_me.length > 0,
      has_blocked_me: u.blocked_by_receiver.length > 0,
    }));
  }

  // ─── Block a user ──────────────────────────────────────────────────────────

  async blockUser(myId: string, targetId: string) {
    if (myId === targetId) {
      throw new BadRequestException('You cannot block yourself');
    }

    const target = await this.prisma.user.findUnique({
      where: { id: targetId },
      select: { id: true },
    });
    if (!target) throw new NotFoundException('User not found');

    try {
      await this.prisma.block.create({
        data: { blocker_id: myId, blocked_id: targetId },
      });
    } catch (err: any) {
      // Unique constraint violation — already blocked
      if (err?.code === 'P2002') {
        throw new ConflictException('User is already blocked');
      }
      throw err;
    }

    return { message: 'User blocked successfully' };
  }

  // ─── Unblock a user ────────────────────────────────────────────────────────

  async unblockUser(myId: string, targetId: string) {
    await this.prisma.block.deleteMany({
      where: { blocker_id: myId, blocked_id: targetId },
    });
    return { message: 'User unblocked successfully' };
  }
}
