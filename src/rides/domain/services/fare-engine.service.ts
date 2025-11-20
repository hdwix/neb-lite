/* istanbul ignore file */
import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface FareCalculationInput {
  distanceKm: number;
  discountAmount?: number;
}

export interface FareCalculationResult {
  roundedDistanceKm: number;
  baseFare: number;
  discountPercent: number;
  discountAmount: number;
  fareAfterDiscount: number;
  appFeeAmount: number;
  finalFare: number;
}

@Injectable()
export class FareEngineService {
  private readonly fareRatePerKm: number;
  private readonly appFeePercent: number;
  private readonly appFeeMinimumAmount: number;
  private readonly appFeeMinimumThreshold: number;

  constructor(private readonly configService: ConfigService) {
    this.fareRatePerKm = this.getNumberConfig('DEFAULT_FARE_RATE_PER_KM', 3000);
    this.appFeePercent = this.getNumberConfig('APP_FEE_PERCENT', 5);
    this.appFeeMinimumAmount = this.getNumberConfig('APP_FEE_MIN_AMOUNT', 3000);
    this.appFeeMinimumThreshold = this.getNumberConfig('APP_FEE_MIN_THRESHOLD', 10_000);
  }

  calculateFare({ distanceKm, discountAmount }: FareCalculationInput): FareCalculationResult {
    const roundedDistanceKm = this.roundDistanceKm(distanceKm);
    const baseFare = Math.max(0, roundedDistanceKm * this.fareRatePerKm);

    const normalizedDiscount = this.resolveDiscountAmount(baseFare, discountAmount);
    const fareAfterDiscount = this.calculateMonetaryAmount(baseFare - normalizedDiscount);
    const discountPercent = this.calculateDiscountPercent(baseFare, normalizedDiscount);
    const appFeeAmount = this.calculateAppFee(fareAfterDiscount);
    const finalFare = this.calculateMonetaryAmount(fareAfterDiscount + appFeeAmount);

    return {
      roundedDistanceKm,
      baseFare,
      discountPercent,
      discountAmount: normalizedDiscount,
      fareAfterDiscount,
      appFeeAmount,
      finalFare,
    };
  }

  calculateEstimatedFare(distanceKm?: number | null): string | null {
    if (
      distanceKm === undefined ||
      distanceKm === null ||
      Number.isNaN(distanceKm)
    ) {
      return null;
    }

    const fare = distanceKm * this.fareRatePerKm;
    return fare.toFixed(2);
  }

  private calculateMonetaryAmount(value: number): number {
    if (!Number.isFinite(value) || value <= 0) {
      return 0;
    }
    return Math.round(value * 100) / 100;
  }

  private resolveDiscountAmount(baseFare: number, discountAmount?: number): number {
    if (!Number.isFinite(baseFare) || baseFare <= 0) {
      return 0;
    }

    if (discountAmount === undefined || discountAmount === null) {
      return 0;
    }

    const normalized = Number(discountAmount);

    if (!Number.isFinite(normalized) || normalized < 0) {
      throw new BadRequestException('Invalid discount amount');
    }

    if (normalized > baseFare) {
      throw new BadRequestException('Discount amount exceeds calculated fare');
    }

    if (normalized === 0) {
      return 0;
    }

    return this.calculateMonetaryAmount(normalized);
  }

  private calculateDiscountPercent(baseFare: number, discountAmount: number): number {
    if (!Number.isFinite(baseFare) || baseFare <= 0) {
      return 0;
    }

    if (!Number.isFinite(discountAmount) || discountAmount <= 0) {
      return 0;
    }

    const ratio = (discountAmount / baseFare) * 100;
    const bounded = Math.min(Math.max(ratio, 0), 100);
    return Math.round(bounded * 100) / 100;
  }

  private calculateAppFee(fareAfterDiscount: number): number {
    if (!Number.isFinite(fareAfterDiscount) || fareAfterDiscount <= 0) {
      return this.appFeeMinimumAmount;
    }

    if (fareAfterDiscount < this.appFeeMinimumThreshold) {
      return this.appFeeMinimumAmount;
    }

    return this.calculateMonetaryAmount((fareAfterDiscount * this.appFeePercent) / 100);
  }

  private roundDistanceKm(distanceKm: number): number {
    return Number(distanceKm.toFixed(3));
  }

  private getNumberConfig(key: string, defaultValue: number): number {
    const value = this.configService.get(key);

    if (typeof value === 'number') {
      return value;
    }

    if (typeof value === 'string') {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }

    return defaultValue;
  }
}
