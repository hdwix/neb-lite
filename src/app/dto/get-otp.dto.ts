import { IsEnum, IsString, Validate } from 'class-validator';
import { EClientType } from '../enums/client-type.enum';
import { IsPhoneNumberFormatted } from '../common/isPhoneNumber.validator';

export class GetOtpDto {
  @IsString()
  clientId: string;

  @IsString()
  @IsEnum(EClientType)
  clientType: EClientType;
}
