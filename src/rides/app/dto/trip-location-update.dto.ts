import { Type } from 'class-transformer';
import { IsNotEmptyObject, ValidateNested } from 'class-validator';
import { TripLocationDto } from './trip-location.dto';

export class TripLocationUpdateDto {
  @IsNotEmptyObject()
  @ValidateNested()
  @Type(() => TripLocationDto)
  location!: TripLocationDto;
}
