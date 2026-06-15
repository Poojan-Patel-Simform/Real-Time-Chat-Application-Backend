import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service.js';
import { MessageStatus, DeletedFor } from '../generated/prisma/enums.js';
import type { SendMessageDto } from './dto/send-message.dto.js';
import type { GetMessagesDto } from './dto/get-messages.dto.js';
import { DeleteScope } from './dto/delete-message.dto.js';

@Injectable()
export class ChatService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Helpers ───────────────────────────────────────────────────────────────

  /** Check if either party has blocked the other. Returns true if blocked. */
  async isBlocked(userA: string, userB: string): Promise<boolean> {
    const block = await this.prisma.block.findFirst({
      where: {
        OR: [
          { blocker_id: userA, blocked_id: userB },
          { blocker_id: userB, blocked_id: userA },
        ],
      },
      select: { id: true },
    });
    return block !== null;
  }

  /** Returns true if the user has at least one active presence row. */
  async isOnline(userId: string): Promise<boolean> {
    const count = await this.prisma.userPresence.count({
      where: { user_id: userId },
    });
    return count > 0;
  }

  // ─── Send message ──────────────────────────────────────────────────────────

  async sendMessage(senderId: string, dto: SendMessageDto) {
    const { receiverId, content } = dto;

    if (senderId === receiverId) {
      throw new ForbiddenException('You cannot send a message to yourself');
    }

    const receiver = await this.prisma.user.findUnique({
      where: { id: receiverId },
      select: { id: true },
    });
    if (!receiver) throw new NotFoundException('Receiver not found');

    if (await this.isBlocked(senderId, receiverId)) {
      throw new ForbiddenException(
        'Cannot send message — a block exists between these users',
      );
    }

    const receiverOnline = await this.isOnline(receiverId);

    const message = await this.prisma.message.create({
      data: {
        sender_id: senderId,
        receiver_id: receiverId,
        content,
        status: receiverOnline ? MessageStatus.DELIVERED : MessageStatus.SENT,
      },
      select: {
        id: true,
        sender_id: true,
        receiver_id: true,
        content: true,
        status: true,
        deleted_for: true,
        read_at: true,
        created_at: true,
        updated_at: true,
      },
    });

    return message;
  }

  // ─── Load messages (cursor-based, 25 per page) ─────────────────────────────

  async loadMessages(userId: string, dto: GetMessagesDto) {
    const { otherUserId, cursor, limit = 25 } = dto;

    const messages = await this.prisma.message.findMany({
      where: {
        OR: [
          {
            sender_id: userId,
            receiver_id: otherUserId,
            // Sender cannot see messages deleted for them
            deleted_for: { notIn: [DeletedFor.SENDER, DeletedFor.BOTH] },
          },
          {
            sender_id: otherUserId,
            receiver_id: userId,
            // Receiver cannot see messages deleted for them
            deleted_for: { notIn: [DeletedFor.RECEIVER, DeletedFor.BOTH] },
          },
        ],
      },
      ...(cursor && {
        cursor: { id: cursor },
        skip: 1,
      }),
      orderBy: { created_at: 'desc' },
      take: limit,
      select: {
        id: true,
        sender_id: true,
        receiver_id: true,
        content: true,
        status: true,
        deleted_for: true,
        read_at: true,
        created_at: true,
        updated_at: true,
      },
    });

    const nextCursor =
      messages.length === limit ? messages[messages.length - 1].id : null;

    // Reverse so oldest is first (for rendering top-to-bottom in UI)
    return { messages: messages.reverse(), nextCursor };
  }

  // ─── Mark message delivered ────────────────────────────────────────────────

  async markDelivered(receiverId: string, messageId: string) {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      select: { id: true, sender_id: true, receiver_id: true, status: true },
    });

    if (message?.receiver_id !== receiverId) return null;
    if (message?.status !== MessageStatus.SENT) return null;

    const updated = await this.prisma.message.update({
      where: { id: messageId },
      data: { status: MessageStatus.DELIVERED },
      select: { id: true, sender_id: true, status: true },
    });

    return updated;
  }

  // ─── Mark message read ─────────────────────────────────────────────────────

  async markRead(receiverId: string, messageId: string) {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      select: { id: true, sender_id: true, receiver_id: true, status: true },
    });

    if (message?.receiver_id !== receiverId) return null;
    if (message?.status === MessageStatus.READ) return null;

    const updated = await this.prisma.message.update({
      where: { id: messageId },
      data: { status: MessageStatus.READ, read_at: new Date() },
      select: { id: true, sender_id: true, status: true, read_at: true },
    });

    return updated;
  }

  // ─── Helpers for delete logic ───────────────────────────────────────────────

  private calcDeletedFor(current: DeletedFor, isSender: boolean): DeletedFor {
    if (isSender) {
      return current === DeletedFor.RECEIVER
        ? DeletedFor.BOTH
        : DeletedFor.SENDER;
    }
    return current === DeletedFor.SENDER
      ? DeletedFor.BOTH
      : DeletedFor.RECEIVER;
  }

  // ─── Delete message ────────────────────────────────────────────────────────

  async deleteMessage(
    userId: string,
    messageId: string,
    deleteFor: DeleteScope,
  ) {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      select: {
        id: true,
        sender_id: true,
        receiver_id: true,
        deleted_for: true,
      },
    });

    if (!message) throw new NotFoundException('Message not found');

    const isSender = message.sender_id === userId;
    const isReceiver = message.receiver_id === userId;

    if (!isSender && !isReceiver) {
      throw new ForbiddenException('You are not a participant of this message');
    }

    let newDeletedFor: DeletedFor;

    if (deleteFor === DeleteScope.BOTH) {
      if (!isSender) {
        throw new ForbiddenException(
          'Only the sender can delete a message for both parties',
        );
      }
      newDeletedFor = DeletedFor.BOTH;
    } else {
      newDeletedFor = this.calcDeletedFor(message.deleted_for, isSender);
    }

    await this.prisma.message.update({
      where: { id: messageId },
      data: { deleted_for: newDeletedFor },
    });

    return {
      messageId,
      deletedFor: newDeletedFor,
      senderId: message.sender_id,
      receiverId: message.receiver_id,
    };
  }
}
