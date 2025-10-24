import { IsString, Validate } from 'class-validator';
import { IsPhoneNumberFormatted } from '../common/isPhoneNumber.validator';

export class MsisdnParamDto {
  @IsString()
  @Validate(IsPhoneNumberFormatted, {
    message: 'msisdn must be valid Telkomsel number and in E164 format',
  })
  msisdn: string;
}
