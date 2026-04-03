import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import type { GetUsersDto } from './dto/get-users.dto.js';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── List users with pagination, filters, and search ──────────────────────

  async getUsers(myId: string, dto: GetUsersDto) {
    const { page, limit, search, isOnline, blockedByMe, blockedByReceiver } =
      dto;

    const where: Prisma.UserWhereInput = {
      id: { not: myId },
      is_profile_complete: true,
    };

    // Search by username or display_name (case-insensitive)
    if (search) {
      where.profile = {
        OR: [
          { username: { contains: search, mode: 'insensitive' } },
          { display_name: { contains: search, mode: 'insensitive' } },
        ],
      };
    }

    // Online / offline filter
    if (isOnline === true) {
      where.presence = { some: {} };
    } else if (isOnline === false) {
      where.presence = { none: {} };
    }

    // Users I have blocked: I am the blocker (blocker_id = myId, blocked_id = u.id)
    // Those rows live on the `blocked_by_receiver` relation of the target user
    // because on the target user the relation is "someone blocked them"
    if (blockedByMe === true) {
      where.blocked_by_receiver = { some: { blocker_id: myId } };
    }

    // Users who have blocked me: they are the blocker (blocker_id = u.id, blocked_id = myId)
    // Those rows live on the `blocked_by_me` relation of the target user
    if (blockedByReceiver === true) {
      where.blocked_by_me = { some: { blocked_id: myId } };
    }

    const skip = (page - 1) * limit;

    const [total, users] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy: { created_at: 'asc' },
        select: {
          id: true,
          profile: {
            select: {
              username: true,
              display_name: true,
              avatar_url: true,
              bio: true,
              dob: true,
              gender: true,
            },
          },
          // Any presence row → user is online
          presence: { select: { id: true } },
          // Rows where I (myId) am the blocker and this user is blocked_id
          // → lives on blocked_by_receiver because this user is the "blocked" side
          blocked_by_receiver: {
            where: { blocker_id: myId },
            select: { id: true },
          },
          // Rows where this user is the blocker and I (myId) am blocked_id
          // → lives on blocked_by_me because this user is the "blocker" side
          blocked_by_me: {
            where: { blocked_id: myId },
            select: { id: true },
          },
        },
      }),
    ]);

    return {
      users: users.map((u) => ({
        id: u.id,
        username: u.profile?.username ?? null,
        display_name: u.profile?.display_name ?? null,
        avatar_url: u.profile?.avatar_url ?? null,
        bio: u.profile?.bio ?? null,
        dob: u.profile?.dob ?? null,
        gender: u.profile?.gender ?? null,
        is_online: u.presence.length > 0,
        is_blocked_by_me: u.blocked_by_receiver.length > 0,
        has_blocked_me: u.blocked_by_me.length > 0,
      })),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  // ─── Get single user by ID ───────────────────────────────────────────────

  async getUserById(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        is_profile_complete: true,
        created_at: true,
        profile: {
          select: {
            username: true,
            display_name: true,
            avatar_url: true,
            bio: true,
            dob: true,
            gender: true,
          },
        },
        presence: { select: { id: true } },
      },
    });

    if (!user) throw new NotFoundException('User not found');

    return {
      id: user.id,
      is_profile_complete: user.is_profile_complete,
      created_at: user.created_at,
      username: user.profile?.username ?? null,
      display_name: user.profile?.display_name ?? null,
      avatar_url: user.profile?.avatar_url ?? null,
      bio: user.profile?.bio ?? null,
      dob: user.profile?.dob ?? null,
      gender: user.profile?.gender ?? null,
      is_online: user.presence.length > 0,
    };
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
