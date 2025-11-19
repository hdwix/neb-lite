import { IsEnum, IsString, Validate } from 'class-validator';
import { EClientType } from '../enums/client-type.enum';
import { IsPhoneNumberFormatted } from '../common/isPhoneNumber.validator';

export class GetOtpDto {
  @IsString()
  // @Validate(IsPhoneNumberFormatted, {
  //   message: 'phone must be valid Telkomsel number and in E164 format',
  // })
  clientId: string;

  @IsString()
  @IsEnum(EClientType)
  clientType: EClientType;
}
