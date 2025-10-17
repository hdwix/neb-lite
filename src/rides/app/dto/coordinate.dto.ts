import { IsNumber } from 'class-validator';

export class CoordinateDto {
  @IsNumber()
  lon!: number;

  @IsNumber()
  lat!: number;
}
