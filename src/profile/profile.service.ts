import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service.js';
import { CloudinaryService } from '../cloudinary/cloudinary.service.js';
import { Gender } from '../generated/prisma/enums.js';
import type { SetupProfileDto } from './dto/setup-profile.dto.js';

@Injectable()
export class ProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cloudinaryService: CloudinaryService,
  ) {}

  async setupProfile(
    userId: string,
    dto: SetupProfileDto,
    avatarFile?: Express.Multer.File,
  ) {
    const existingProfile = await this.prisma.profile.findUnique({
      where: { user_id: userId },
      select: { id: true },
    });

    if (existingProfile) {
      throw new BadRequestException('Profile has already been set up');
    }

    const usernameTaken = await this.prisma.profile.findUnique({
      where: { username: dto.username.toLowerCase() },
      select: { id: true },
    });

    if (usernameTaken) {
      throw new ConflictException('This username is already taken');
    }

    let avatarUrl: string | undefined;
    if (avatarFile) {
      avatarUrl = await this.cloudinaryService.uploadAvatar(avatarFile, userId);
    }

    const profile = await this.prisma.$transaction(async (tx) => {
      const created = await tx.profile.create({
        data: {
          user_id: userId,
          username: dto.username.toLowerCase(),
          display_name: dto.display_name,
          bio: dto.bio,
          avatar_url: avatarUrl,
          dob: new Date(dto.dob),
          gender: dto.gender ?? Gender.PREFER_NOT_TO_SAY,
        },
        select: {
          id: true,
          username: true,
          display_name: true,
          bio: true,
          avatar_url: true,
          dob: true,
          gender: true,
          created_at: true,
        },
      });

      await tx.user.update({
        where: { id: userId },
        data: { is_profile_complete: true },
      });

      return created;
    });

    return { message: 'Profile set up successfully', profile };
  }
}
