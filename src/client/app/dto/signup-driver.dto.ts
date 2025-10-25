import { IsNotEmpty, IsOptional, IsString, Validate } from 'class-validator';
import { IsPhoneNumberFormatted } from '../../../app/common/isPhoneNumber.validator';

export class SignupDriverDto {
  @IsString()
  @Validate(IsPhoneNumberFormatted, {
    message: 'msisdn must be valid Telkomsel number and in E164 format',
  })
  msisdn!: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsString()
  @IsNotEmpty()
  driverLicenseNumber!: string;

  @IsString()
  @IsNotEmpty()
  vehicleLicensePlate!: string;
}
