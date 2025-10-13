import { IsString, Validate } from 'class-validator';
import { IsPhoneNumberFormatted } from '../../common/isPhoneNumber.validator';

export class GetOtpDto {
  @IsString()
  @Validate(IsPhoneNumberFormatted, {
    message: 'phone must be valid Telkomsel number and in E164 format',
  })
  phone: string;
}
