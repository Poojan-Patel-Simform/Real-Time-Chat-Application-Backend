import { IsString, Length } from 'class-validator';

export class RefreshTokenDto {
  @IsString()
  @Length(64, 64, { message: 'Invalid refresh token' })
  refresh_token: string;
}
