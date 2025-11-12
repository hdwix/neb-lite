import { Type } from 'class-transformer';
import {
  IsNotEmptyObject,
  IsNumber,
  IsOptional,
  Min,
  ValidateNested,
} from 'class-validator';
import { TripLocationDto } from './trip-location.dto';

export class CompleteRideDto {
  @IsNotEmptyObject()
  @ValidateNested()
  @Type(() => TripLocationDto)
  driverLocation!: TripLocationDto;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 })
  @Min(0)
  discountAmount?: number;
}
