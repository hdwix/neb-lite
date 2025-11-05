import { Type } from 'class-transformer';
import {
  IsISO8601,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { CoordinateDto } from './coordinate.dto';

export class TripLocationDto {
  @ValidateNested()
  @Type(() => CoordinateDto)
  @IsNotEmpty()
  coordinate!: CoordinateDto;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(5000)
  accuracyMeters?: number;

  @IsOptional()
  @IsISO8601()
  recordedAt?: string;
}

export function toParticipantLocation(
  input: TripLocationDto,
): {
  longitude: number;
  latitude: number;
  accuracyMeters?: number | null;
  recordedAt: string;
} {
  const recordedAt = input.recordedAt ?? new Date().toISOString();
  return {
    longitude: input.coordinate.longitude,
    latitude: input.coordinate.latitude,
    accuracyMeters: input.accuracyMeters ?? null,
    recordedAt,
  };
}
