import { Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsNumber, IsOptional, Min } from 'class-validator';

export class GetNearbyDriversDto {
  @Type(() => Number)
  @IsNumber()
  @IsNotEmpty()
  lon: number;

  @Type(() => Number)
  @IsNumber()
  @IsNotEmpty()
  lat: number;

  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  limit?: number;
}
