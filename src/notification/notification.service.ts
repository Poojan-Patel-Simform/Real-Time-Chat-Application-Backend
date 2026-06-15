import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service.js';
import { MessageStatus, DeletedFor } from '../generated/prisma/enums.js';

@Injectable()
export class NotificationService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Returns the number of unread messages for a given user.
   * "Unread" means the message is SENT or DELIVERED and not deleted
   * for the receiver.
   */
  async getUnreadCount(userId: string): Promise<number> {
    return this.prisma.message.count({
      where: {
        receiver_id: userId,
        status: { not: MessageStatus.READ },
        deleted_for: { notIn: [DeletedFor.RECEIVER, DeletedFor.BOTH] },
      },
    });
  }

  /**
   * Marks all unread messages for the user as READ and sets read_at to now.
   * Returns the number of messages updated.
   */
  async markAllRead(userId: string): Promise<number> {
    const result = await this.prisma.message.updateMany({
      where: {
        receiver_id: userId,
        status: { not: MessageStatus.READ },
        deleted_for: { notIn: [DeletedFor.RECEIVER, DeletedFor.BOTH] },
      },
      data: {
        status: MessageStatus.READ,
        read_at: new Date(),
      },
    });
    return result.count;
  }
}
