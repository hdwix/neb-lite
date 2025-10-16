import { IsNotEmpty, IsNumber, IsOptional, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class UpsertDriverLocationDto {
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
  @IsNumber()
  @Min(0)
  accuracyMeters?: number;
}
