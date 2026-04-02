import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma.service.js';

@Injectable()
export class PresenceService {
  private readonly logger = new Logger(PresenceService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Safety-net cron — deletes presence rows whose last_seen heartbeat
   * is older than 2 minutes. Catches crashed / ungracefully closed sockets.
   * Runs every minute.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async cleanStalePresence() {
    const cutoff = new Date(Date.now() - 2 * 60 * 1000);
    const { count } = await this.prisma.userPresence.deleteMany({
      where: { last_seen: { lt: cutoff } },
    });
    if (count > 0) {
      this.logger.log(`Cleaned ${count} stale presence row(s)`);
    }
  }
}
