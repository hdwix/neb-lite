import { IsEnum, IsString, Length, Validate } from 'class-validator';
import { EClientType } from '../enums/client-type.enum';
import { IsPhoneNumberFormatted } from '../common/isPhoneNumber.validator';

export class VerifyOtpDto {
  @IsString()
  clientId: string;

  @IsString()
  @Length(6, 6)
  otpCode: string;

  @IsString()
  @IsEnum(EClientType)
  clientType: EClientType;
}
