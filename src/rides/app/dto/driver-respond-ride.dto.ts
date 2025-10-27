import { IsOptional, IsString } from 'class-validator';

export class DriverRespondRideDto {
  @IsOptional()
  @IsString()
  reason?: string;
}
