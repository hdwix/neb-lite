import {
  IsInt,
  IsOptional,
  IsPositive,
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

  @IsOptional()
  @Type(() => Number)
  @IsPositive()
  @IsInt()
  maxDrivers?: number;
}
