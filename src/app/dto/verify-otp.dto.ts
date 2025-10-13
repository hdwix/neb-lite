import { IsString, Length, Validate } from 'class-validator';
import { IsPhoneNumberFormatted } from '../../common/isPhoneNumber.validator';

export class VerifyOtpDto {
  @IsString()
  @Validate(IsPhoneNumberFormatted, {
    message: 'phone must be valid Telkomsel number and in E164 format',
  })
  phone: string;

  @IsString()
  @Length(6, 6)
  otpCode: string;
}
