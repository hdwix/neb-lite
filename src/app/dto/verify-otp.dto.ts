import { IsEnum, IsString, Length, Validate } from 'class-validator';
import { EClientType } from '../enums/client-type.enum';
import { IsPhoneNumberFormatted } from '../common/isPhoneNumber.validator';

export class VerifyOtpDto {
  @IsString()
  // @Validate(IsPhoneNumberFormatted, {
  //   message: 'phone must be valid Telkomsel number and in E164 format',
  // })
  clientId: string;

  @IsString()
  @Length(6, 6)
  otpCode: string;

  @IsString()
  @IsEnum(EClientType)
  clientType: EClientType;
}
