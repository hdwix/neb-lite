import { Type } from 'class-transformer';
import {
  IsInt,
  IsLatitude,
  IsLongitude,
  IsNotEmpty,
  IsOptional,
  Min,
} from 'class-validator';

export class GetNearbyDriversDto {
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
  @IsInt()
  @Min(1)
  limit?: number;

}
