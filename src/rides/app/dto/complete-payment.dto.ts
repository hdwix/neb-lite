import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CompletePaymentDto {
  @IsOptional()
  @IsString()
  @MaxLength(128)
  paymentReference?: string;
}
