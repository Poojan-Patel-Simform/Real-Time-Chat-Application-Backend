import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ChatGateway } from './chat.gateway.js';
import { ChatService } from './chat.service.js';
import { PrismaService } from '../prisma.service.js';
import { NotificationModule } from '../notification/notification.module.js';

@Module({
  imports: [JwtModule.register({}), NotificationModule],
  providers: [ChatGateway, ChatService, PrismaService],
})
export class ChatModule {}
