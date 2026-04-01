import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly fromEmail: string;
  private readonly transporter: nodemailer.Transporter;

  constructor(private readonly configService: ConfigService) {
    this.fromEmail = this.configService.getOrThrow<string>(
      'MAILTRAP_FROM_EMAIL',
    );
    this.transporter = nodemailer.createTransport({
      host: this.configService.getOrThrow<string>('MAILTRAP_HOST'),
      port: this.configService.get<number>('MAILTRAP_PORT', 587),
      auth: {
        user: this.configService.getOrThrow<string>('MAILTRAP_USER'),
        pass: this.configService.getOrThrow<string>('MAILTRAP_PASS'),
      },
    });
  }

  async sendVerificationEmail(to: string, token: string): Promise<void> {
    const appUrl = this.configService.getOrThrow<string>('APP_URL');
    const verifyUrl = `${appUrl}/api/auth/verify-email?token=${token}`;

    try {
      await this.transporter.sendMail({
        to,
        from: this.fromEmail,
        subject: 'Verify your email address',
        html: `
          <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;">
            <h2 style="color:#1F2937;">Welcome! Verify your email</h2>
            <p style="color:#374151;">Click the button below to verify your email. This link expires in <strong>24 hours</strong>.</p>
            <a href="${verifyUrl}"
               style="display:inline-block;padding:12px 24px;background:#4F46E5;color:#fff;text-decoration:none;border-radius:6px;font-weight:600;margin:16px 0;">
              Verify Email
            </a>
            <p style="color:#6B7280;font-size:13px;margin-top:24px;">
              If you did not create an account, you can safely ignore this email.
            </p>
          </div>
        `,
      });
    } catch (error) {
      this.logger.error('Failed to send verification email', error);
      throw new InternalServerErrorException(
        'Failed to send verification email',
      );
    }
  }

  async sendPasswordResetEmail(to: string, token: string): Promise<void> {
    const appUrl = this.configService.getOrThrow<string>('APP_URL');
    const resetUrl = `${appUrl}/api/auth/reset-password?token=${token}`;

    try {
      await this.transporter.sendMail({
        to,
        from: this.fromEmail,
        subject: 'Reset your password',
        html: `
          <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;">
            <h2 style="color:#1F2937;">Password Reset Request</h2>
            <p style="color:#374151;">Click the button below to reset your password. This link expires in <strong>1 hour</strong>.</p>
            <a href="${resetUrl}"
               style="display:inline-block;padding:12px 24px;background:#4F46E5;color:#fff;text-decoration:none;border-radius:6px;font-weight:600;margin:16px 0;">
              Reset Password
            </a>
            <p style="color:#6B7280;font-size:13px;margin-top:24px;">
              If you did not request a password reset, you can safely ignore this email.
            </p>
          </div>
        `,
      });
    } catch (error) {
      this.logger.error('Failed to send password reset email', error);
      throw new InternalServerErrorException(
        'Failed to send password reset email',
      );
    }
  }
}
