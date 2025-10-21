import {
  IsLatitude,
  IsLongitude,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class UpsertDriverLocationDto {
  @Type(() => Number)
  @IsLongitude()
  @IsNotEmpty()
  longitude: number;

  @Type(() => Number)
  @IsLatitude()
  @IsNotEmpty()
  latitude: number;

  @Type(() => Number)
  @IsOptional()
  @IsNumber()
  @Min(0)
  accuracyMeters?: number;
}
