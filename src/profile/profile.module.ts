import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ProfileController } from './profile.controller.js';
import { ProfileService } from './profile.service.js';
import { PrismaService } from '../prisma.service.js';
import { CloudinaryModule } from '../cloudinary/cloudinary.module.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';

@Module({
  imports: [JwtModule.register({}), CloudinaryModule],
  controllers: [ProfileController],
  providers: [ProfileService, PrismaService, JwtAuthGuard],
})
export class ProfileModule {}
