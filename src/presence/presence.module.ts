import { Module } from '@nestjs/common';
import { PresenceService } from './presence.service.js';
import { PrismaService } from '../prisma.service.js';

@Module({
  providers: [PresenceService, PrismaService],
})
export class PresenceModule {}
