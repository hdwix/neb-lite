import { IsNumber, Max, Min } from 'class-validator';

export class ApplyDiscountDto {
  @IsNumber()
  @Min(0)
  @Max(100)
  discountPercent!: number;
}
