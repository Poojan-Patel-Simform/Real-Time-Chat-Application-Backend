import { IsEnum, IsUUID } from 'class-validator';

export enum DeleteScope {
  ME = 'ME',
  BOTH = 'BOTH',
}

export class DeleteMessageDto {
  @IsUUID()
  messageId: string;

  @IsEnum(DeleteScope, { message: 'deleteFor must be ME or BOTH' })
  deleteFor: DeleteScope;
}
