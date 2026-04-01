import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { randomBytes, createHash } from 'node:crypto';
import bcrypt from 'bcrypt';
import type { StringValue } from 'ms';
import { PrismaService } from '../prisma.service.js';
import { EmailService } from '../email/email.service.js';
import { TokenType } from '../generated/prisma/enums.js';
import type { RegisterDto } from './dto/register.dto.js';
import type { LoginDto } from './dto/login.dto.js';
import type { VerifyEmailDto } from './dto/verify-email.dto.js';
import type { ForgotPasswordDto } from './dto/forgot-password.dto.js';
import type { ResetPasswordDto } from './dto/reset-password.dto.js';
import type { RefreshTokenDto } from './dto/refresh-token.dto.js';
import type { LogoutDto } from './dto/logout.dto.js';

// Pre-generated hash used only to normalise response time when user is not found,
// preventing user-enumeration via timing differences.
const TIMING_SAFE_DUMMY_HASH =
  '$2b$12$LRKoBiMFGtX7c78d4fN1K.YKbhVXAb8nVwHWS0.2V0dYZLMjjOi.';

@Injectable()
export class AuthService {
  private readonly BCRYPT_ROUNDS = 12;
  private readonly VERIFY_TOKEN_EXPIRY_HOURS = 24;
  private readonly RESET_TOKEN_EXPIRY_HOURS = 1;
  private readonly REFRESH_TOKEN_EXPIRY_DAYS = 7;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly emailService: EmailService,
  ) {}

  // ─── Private Helpers ───────────────────────────────────────────────────────

  /** Returns a 64-character random hex token (32 bytes). */
  private generateOpaqueToken(): string {
    return randomBytes(32).toString('hex');
  }

  /** One-way SHA-256 hash stored in the database. */
  private hashToken(rawToken: string): string {
    return createHash('sha256').update(rawToken).digest('hex');
  }

  private signAccessToken(userId: string, email: string): string {
    return this.jwtService.sign(
      { sub: userId, email },
      {
        secret: this.configService.getOrThrow<string>('JWT_ACCESS_SECRET'),
        expiresIn: (this.configService.get('JWT_ACCESS_EXPIRES_IN') ??
          '15m') as StringValue,
      },
    );
  }

  private addHours(date: Date, hours: number): Date {
    return new Date(date.getTime() + hours * 60 * 60 * 1000);
  }

  private addDays(date: Date, days: number): Date {
    return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
  }

  // ─── Register ──────────────────────────────────────────────────────────────

  async register(dto: RegisterDto): Promise<{ message: string }> {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
      select: { id: true },
    });

    if (existing) {
      throw new ConflictException('An account with this email already exists');
    }

    const passwordHash = await bcrypt.hash(dto.password, this.BCRYPT_ROUNDS);

    const user = await this.prisma.user.create({
      data: {
        email: dto.email.toLowerCase(),
        password_hash: passwordHash,
      },
      select: { id: true, email: true },
    });

    const rawToken = this.generateOpaqueToken();
    await this.prisma.token.create({
      data: {
        user_id: user.id,
        type: TokenType.EMAIL_VERIFY,
        token_hash: this.hashToken(rawToken),
        expires_at: this.addHours(new Date(), this.VERIFY_TOKEN_EXPIRY_HOURS),
      },
    });

    await this.emailService.sendVerificationEmail(user.email, rawToken);

    return {
      message:
        'Registration successful. Please check your email to verify your account.',
    };
  }

  // ─── Verify Email ──────────────────────────────────────────────────────────

  async verifyEmail(dto: VerifyEmailDto): Promise<{ message: string }> {
    const tokenHash = this.hashToken(dto.token);

    const tokenRecord = await this.prisma.token.findFirst({
      where: {
        token_hash: tokenHash,
        type: TokenType.EMAIL_VERIFY,
        is_used: false,
        expires_at: { gt: new Date() },
      },
      select: { id: true, user_id: true },
    });

    if (!tokenRecord) {
      throw new BadRequestException('Invalid or expired verification token');
    }

    await this.prisma.$transaction([
      this.prisma.token.update({
        where: { id: tokenRecord.id },
        data: { is_used: true },
      }),
      this.prisma.user.update({
        where: { id: tokenRecord.user_id },
        data: { is_email_verified: true },
      }),
    ]);

    return { message: 'Email verified successfully. You can now log in.' };
  }

  // ─── Login ─────────────────────────────────────────────────────────────────

  async login(dto: LoginDto): Promise<{
    access_token: string;
    refresh_token: string;
    is_profile_complete: boolean;
  }> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
      select: {
        id: true,
        email: true,
        password_hash: true,
        is_email_verified: true,
        is_profile_complete: true,
      },
    });

    // Always run bcrypt compare to neutralise timing-based user enumeration.
    const hashToCompare = user ? user.password_hash : TIMING_SAFE_DUMMY_HASH;
    const isPasswordValid = await bcrypt.compare(dto.password, hashToCompare);

    if (!user || !isPasswordValid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    if (!user.is_email_verified) {
      throw new UnauthorizedException(
        'Please verify your email address before logging in',
      );
    }

    // Revoke any active refresh tokens for this user (single-session policy).
    await this.prisma.token.updateMany({
      where: {
        user_id: user.id,
        type: TokenType.REFRESH,
        is_used: false,
      },
      data: { is_used: true },
    });

    const accessToken = this.signAccessToken(user.id, user.email);
    const rawRefreshToken = this.generateOpaqueToken();

    await this.prisma.token.create({
      data: {
        user_id: user.id,
        type: TokenType.REFRESH,
        token_hash: this.hashToken(rawRefreshToken),
        expires_at: this.addDays(new Date(), this.REFRESH_TOKEN_EXPIRY_DAYS),
      },
    });

    return {
      access_token: accessToken,
      refresh_token: rawRefreshToken,
      is_profile_complete: user.is_profile_complete,
    };
  }

  // ─── Refresh Tokens ────────────────────────────────────────────────────────

  async refreshTokens(dto: RefreshTokenDto): Promise<{
    access_token: string;
    refresh_token: string;
  }> {
    const tokenHash = this.hashToken(dto.refresh_token);

    const tokenRecord = await this.prisma.token.findFirst({
      where: {
        token_hash: tokenHash,
        type: TokenType.REFRESH,
        is_used: false,
        expires_at: { gt: new Date() },
      },
      include: {
        user: { select: { id: true, email: true } },
      },
    });

    if (!tokenRecord) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const newRawRefreshToken = this.generateOpaqueToken();
    const newAccessToken = this.signAccessToken(
      tokenRecord.user.id,
      tokenRecord.user.email,
    );

    // Atomic rotation: invalidate old, issue new.
    await this.prisma.$transaction([
      this.prisma.token.update({
        where: { id: tokenRecord.id },
        data: { is_used: true },
      }),
      this.prisma.token.create({
        data: {
          user_id: tokenRecord.user_id,
          type: TokenType.REFRESH,
          token_hash: this.hashToken(newRawRefreshToken),
          expires_at: this.addDays(new Date(), this.REFRESH_TOKEN_EXPIRY_DAYS),
        },
      }),
    ]);

    return {
      access_token: newAccessToken,
      refresh_token: newRawRefreshToken,
    };
  }

  // ─── Forgot Password ───────────────────────────────────────────────────────

  async forgotPassword(dto: ForgotPasswordDto): Promise<{ message: string }> {
    // Generic message always returned to prevent email enumeration.
    const GENERIC_MESSAGE =
      'If an account with that email exists, a password reset link has been sent.';

    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
      select: { id: true, email: true, is_email_verified: true },
    });

    if (!user || !user.is_email_verified) {
      return { message: GENERIC_MESSAGE };
    }

    // Invalidate any existing pending reset tokens.
    await this.prisma.token.updateMany({
      where: {
        user_id: user.id,
        type: TokenType.RESET_PASSWORD,
        is_used: false,
      },
      data: { is_used: true },
    });

    const rawToken = this.generateOpaqueToken();
    await this.prisma.token.create({
      data: {
        user_id: user.id,
        type: TokenType.RESET_PASSWORD,
        token_hash: this.hashToken(rawToken),
        expires_at: this.addHours(new Date(), this.RESET_TOKEN_EXPIRY_HOURS),
      },
    });

    await this.emailService.sendPasswordResetEmail(user.email, rawToken);

    return { message: GENERIC_MESSAGE };
  }

  // ─── Reset Password ────────────────────────────────────────────────────────

  async resetPassword(dto: ResetPasswordDto): Promise<{ message: string }> {
    const tokenHash = this.hashToken(dto.token);

    const tokenRecord = await this.prisma.token.findFirst({
      where: {
        token_hash: tokenHash,
        type: TokenType.RESET_PASSWORD,
        is_used: false,
        expires_at: { gt: new Date() },
      },
      select: { id: true, user_id: true },
    });

    if (!tokenRecord) {
      throw new BadRequestException('Invalid or expired password reset token');
    }

    const newPasswordHash = await bcrypt.hash(
      dto.new_password,
      this.BCRYPT_ROUNDS,
    );

    await this.prisma.$transaction([
      // Mark reset token as consumed.
      this.prisma.token.update({
        where: { id: tokenRecord.id },
        data: { is_used: true },
      }),
      // Revoke all active refresh tokens — force re-login after password change.
      this.prisma.token.updateMany({
        where: {
          user_id: tokenRecord.user_id,
          type: TokenType.REFRESH,
          is_used: false,
        },
        data: { is_used: true },
      }),
      // Persist new password.
      this.prisma.user.update({
        where: { id: tokenRecord.user_id },
        data: { password_hash: newPasswordHash },
      }),
    ]);

    return {
      message:
        'Password reset successfully. Please log in with your new password.',
    };
  }

  // ─── Logout ────────────────────────────────────────────────────────────────

  async logout(userId: string, dto: LogoutDto): Promise<{ message: string }> {
    const tokenHash = this.hashToken(dto.refresh_token);

    await this.prisma.token.updateMany({
      where: {
        user_id: userId,
        token_hash: tokenHash,
        type: TokenType.REFRESH,
        is_used: false,
      },
      data: { is_used: true },
    });

    return { message: 'Logged out successfully' };
  }
}
