import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ProfileService } from './profile.service.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { JwtPayload } from '../common/guards/jwt-auth.guard.js';
import { SetupProfileDto } from './dto/setup-profile.dto.js';

const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

@Controller('profile')
export class ProfileController {
  constructor(private readonly profileService: ProfileService) {}

  /** POST /api/profile/setup  (multipart/form-data, requires Bearer token) */
  @Post('setup')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(
    FileInterceptor('avatar', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_FILE_SIZE_BYTES },
      fileFilter: (_req, file, cb) => {
        if (ALLOWED_MIME_TYPES.has(file.mimetype)) {
          cb(null, true);
        } else {
          cb(
            new BadRequestException(
              'Only JPEG, PNG, and WebP images are allowed for avatar',
            ),
            false,
          );
        }
      },
    }),
  )
  setupProfile(
    @CurrentUser() user: JwtPayload,
    @Body() dto: SetupProfileDto,
    @UploadedFile() avatar?: Express.Multer.File,
  ) {
    return this.profileService.setupProfile(user.sub, dto, avatar);
  }
}
