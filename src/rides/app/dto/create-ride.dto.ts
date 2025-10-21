import {
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CoordinateDto } from './coordinate.dto';

export class CreateRideDto {
  @ValidateNested()
  @Type(() => CoordinateDto)
  pickup!: CoordinateDto;

  @ValidateNested()
  @Type(() => CoordinateDto)
  dropoff!: CoordinateDto;

  @IsOptional()
  @IsString()
  note?: string;

  @IsString()
  @IsNotEmpty()
  driverId!: string;
}
