import { IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class SendMessageDto {
  @IsUUID()
  receiverId: string;

  @IsString()
  @MinLength(1, { message: 'Message content cannot be empty' })
  @MaxLength(4000, {
    message: 'Message content must not exceed 4000 characters',
  })
  content: string;
}
