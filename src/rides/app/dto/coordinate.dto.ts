import { IsLatitude, IsLongitude } from 'class-validator';

export class CoordinateDto {
  @IsLongitude()
  longitude!: number;

  @IsLatitude()
  latitude!: number;
}
