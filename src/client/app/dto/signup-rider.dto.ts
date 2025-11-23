import { IsOptional, IsString, Validate } from 'class-validator';
import { IsPhoneNumberFormatted } from '../../../app/common/isPhoneNumber.validator';

export class SignupRiderDto {
  @IsString()
  @Validate(IsPhoneNumberFormatted, {
    message: 'msisdn must be valid Telkomsel number and in E164 format',
  })
  msisdn!: string;

  @IsString()
  name: string;
}
