import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { UsePipes, ValidationPipe } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { ChatService } from './chat.service.js';
import { PrismaService } from '../prisma.service.js';
import { SendMessageDto } from './dto/send-message.dto.js';
import { DeleteMessageDto } from './dto/delete-message.dto.js';
import { GetMessagesDto } from './dto/get-messages.dto.js';
import { TypingDto } from './dto/typing.dto.js';
import { DeletedFor } from '../generated/prisma/enums.js';
import type { JwtPayload } from '../common/guards/jwt-auth.guard.js';

const PERSONAL_ROOM = (userId: string) => `user:${userId}`;

@WebSocketGateway({
  cors: {
    origin: ['http://localhost:5173'],
    credentials: true,
  },
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  private readonly server: Server;

  /** key: `senderId:receiverId` → auto-stop timer handle */
  private readonly typingTimers = new Map<string, NodeJS.Timeout>();

  private typingKey(senderId: string, receiverId: string): string {
    return `${senderId}:${receiverId}`;
  }

  constructor(
    private readonly chatService: ChatService,
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  // ─── Connection ────────────────────────────────────────────────────────────

  async handleConnection(client: Socket) {
    const token: string | undefined = client.handshake.auth?.token;

    if (!token) {
      client.disconnect();
      return;
    }

    let payload: JwtPayload;
    try {
      payload = this.jwtService.verify<JwtPayload>(token, {
        secret: this.configService.getOrThrow<string>('JWT_ACCESS_SECRET'),
      });
    } catch {
      client.disconnect();
      return;
    }

    client.data.user = payload;

    // Insert presence row

    await this.prisma.userPresence.upsert({
      where: {
        socket_id: client.id,
      },
      update: {},
      create: {
        user_id: payload.sub,
        socket_id: client.id,
      },
    });

    // Join personal room for targeted message delivery
    await client.join(PERSONAL_ROOM(payload.sub));

    // Notify all others that this user is online
    client.broadcast.emit('user:online', { userId: payload.sub });
  }

  // ─── Disconnection ─────────────────────────────────────────────────────────

  async handleDisconnect(client: Socket) {
    const userId: string | undefined = client.data.user?.sub;
    if (!userId) return;

    // Remove this socket's presence row
    await this.prisma.userPresence.deleteMany({
      where: { socket_id: client.id },
    });

    // If no more active connections remain → broadcast offline
    const remaining = await this.prisma.userPresence.count({
      where: { user_id: userId },
    });
    if (remaining === 0) {
      this.server.emit('user:offline', { userId });
    }

    // Cancel any dangling typing timers for this user
    for (const key of this.typingTimers.keys()) {
      if (key.startsWith(`${userId}:`)) {
        clearTimeout(this.typingTimers.get(key));
        this.typingTimers.delete(key);
      }
    }
  }

  // ─── Typing indicators ────────────────────────────────────────────────────

  @SubscribeMessage('typing:start')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  async handleTypingStart(
    @ConnectedSocket() client: Socket,
    @MessageBody() dto: TypingDto,
  ) {
    const senderId: string = client.data.user?.sub;
    if (!senderId) return;

    if (await this.chatService.isBlocked(senderId, dto.receiverId)) return;

    const key = this.typingKey(senderId, dto.receiverId);

    // Reset existing auto-stop timer if present
    if (this.typingTimers.has(key)) {
      clearTimeout(this.typingTimers.get(key));
    }

    this.server
      .to(PERSONAL_ROOM(dto.receiverId))
      .emit('typing:start', { senderId });

    // Auto-stop after 5 s in case the client forgets to send typing:stop
    const timer = setTimeout(() => {
      this.typingTimers.delete(key);
      this.server
        .to(PERSONAL_ROOM(dto.receiverId))
        .emit('typing:stop', { senderId });
    }, 5000);

    this.typingTimers.set(key, timer);
  }

  @SubscribeMessage('typing:stop')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  async handleTypingStop(
    @ConnectedSocket() client: Socket,
    @MessageBody() dto: TypingDto,
  ) {
    const senderId: string = client.data.user?.sub;
    if (!senderId) return;

    if (await this.chatService.isBlocked(senderId, dto.receiverId)) return;

    const key = this.typingKey(senderId, dto.receiverId);

    if (this.typingTimers.has(key)) {
      clearTimeout(this.typingTimers.get(key));
      this.typingTimers.delete(key);
    }

    this.server
      .to(PERSONAL_ROOM(dto.receiverId))
      .emit('typing:stop', { senderId });
  }

  // ─── Send message ──────────────────────────────────────────────────────────

  @SubscribeMessage('message:send')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  async handleSendMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() dto: SendMessageDto,
  ) {
    const senderId: string = client.data.user?.sub;
    if (!senderId) {
      client.emit('error', { message: 'Unauthorized' });
      return;
    }

    try {
      const message = await this.chatService.sendMessage(senderId, dto);

      // Deliver to receiver's room (all their active tabs/devices)
      this.server
        .to(PERSONAL_ROOM(dto.receiverId))
        .emit('message:new', message);

      // Confirm back to sender
      client.emit('message:new', message);
    } catch (err: any) {
      client.emit('error', {
        message: err.message ?? 'Failed to send message',
      });
    }
  }

  // ─── Mark delivered ────────────────────────────────────────────────────────

  @SubscribeMessage('message:delivered')
  async handleDelivered(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { messageId: string },
  ) {
    const receiverId: string = client.data.user?.sub;
    if (!receiverId || !data?.messageId) return;

    const updated = await this.chatService.markDelivered(
      receiverId,
      data.messageId,
    );
    if (updated) {
      // Notify the sender
      this.server.to(PERSONAL_ROOM(updated.sender_id)).emit('message:status', {
        messageId: updated.id,
        status: updated.status,
      });
    }
  }

  // ─── Mark read ─────────────────────────────────────────────────────────────

  @SubscribeMessage('message:read')
  async handleRead(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { messageId: string },
  ) {
    const receiverId: string = client.data.user?.sub;
    if (!receiverId || !data?.messageId) return;

    const updated = await this.chatService.markRead(receiverId, data.messageId);
    if (updated) {
      this.server.to(PERSONAL_ROOM(updated.sender_id)).emit('message:status', {
        messageId: updated.id,
        status: updated.status,
        read_at: updated.read_at,
      });
    }
  }

  // ─── Load messages (reverse infinite scroll) ───────────────────────────────

  @SubscribeMessage('messages:load')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  async handleLoadMessages(
    @ConnectedSocket() client: Socket,
    @MessageBody() dto: GetMessagesDto,
  ) {
    const userId: string = client.data.user?.sub;
    if (!userId) {
      client.emit('error', { message: 'Unauthorized' });
      return;
    }

    try {
      const result = await this.chatService.loadMessages(userId, dto);
      client.emit('messages:history', result);
    } catch (err: any) {
      client.emit('error', {
        message: err.message ?? 'Failed to load messages',
      });
    }
  }

  // ─── Delete message ────────────────────────────────────────────────────────

  @SubscribeMessage('message:delete')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  async handleDeleteMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() dto: DeleteMessageDto,
  ) {
    const userId: string = client.data.user?.sub;
    if (!userId) {
      client.emit('error', { message: 'Unauthorized' });
      return;
    }

    try {
      const result = await this.chatService.deleteMessage(
        userId,
        dto.messageId,
        dto.deleteFor,
      );

      const payload = {
        messageId: result.messageId,
        deletedFor: result.deletedFor,
      };

      if (result.deletedFor === DeletedFor.BOTH) {
        // Notify both parties
        this.server
          .to(PERSONAL_ROOM(result.senderId))
          .emit('message:deleted', payload);
        this.server
          .to(PERSONAL_ROOM(result.receiverId))
          .emit('message:deleted', payload);
      } else {
        // Only the requesting user needs to update their UI
        client.emit('message:deleted', payload);
      }
    } catch (err: any) {
      client.emit('error', {
        message: err.message ?? 'Failed to delete message',
      });
    }
  }
}
