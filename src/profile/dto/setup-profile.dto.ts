import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Gender } from '../../generated/prisma/enums.js';

export class SetupProfileDto {
  @IsString()
  @MinLength(3, { message: 'Username must be at least 3 characters' })
  @MaxLength(30, { message: 'Username must not exceed 30 characters' })
  @Matches(/^[a-zA-Z0-9_]+$/, {
    message: 'Username can only contain letters, numbers, and underscores',
  })
  username: string;

  @IsString()
  @MinLength(1, { message: 'Display name is required' })
  @MaxLength(80, { message: 'Display name must not exceed 80 characters' })
  display_name: string;

  @IsOptional()
  @IsString()
  @MaxLength(300, { message: 'Bio must not exceed 300 characters' })
  bio?: string;

  @IsDateString(
    {},
    { message: 'Date of birth must be a valid ISO date (YYYY-MM-DD)' },
  )
  dob: string;

  @IsOptional()
  @IsEnum(Gender, {
    message:
      'Gender must be one of: MALE, FEMALE, NON_BINARY, PREFER_NOT_TO_SAY',
  })
  gender?: Gender;
}
