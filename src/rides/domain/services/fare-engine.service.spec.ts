import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';
import { FareEngineService } from './fare-engine.service';

describe('FareEngineService', () => {
  let configService: jest.Mocked<ConfigService>;
  let service: FareEngineService;

  beforeEach(() => {
    configService = {
      get: jest.fn((key: string) => {
        const defaults: Record<string, number> = {
          DEFAULT_FARE_RATE_PER_KM: 3000,
          APP_FEE_PERCENT: 5,
          APP_FEE_MIN_AMOUNT: 3000,
          APP_FEE_MIN_THRESHOLD: 10000,
        };
        return defaults[key] ?? undefined;
      }),
    } as unknown as jest.Mocked<ConfigService>;

    service = new FareEngineService(configService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('calculates fare with rounded distance, discount, and app fee', () => {
    const result = service.calculateFare({
      distanceKm: 5.1234,
      discountAmount: 1000,
    });

    expect(result.roundedDistanceKm).toBe(5.123);
    expect(result.baseFare).toBeCloseTo(15369);
    expect(result.discountAmount).toBe(1000);
    expect(result.discountPercent).toBeCloseTo(6.51);
    expect(result.fareAfterDiscount).toBeCloseTo(14369);
    expect(result.appFeeAmount).toBeCloseTo(718.45);
    expect(result.finalFare).toBeCloseTo(15087.45);
  });

  it('applies minimum app fee when fare after discount is zero or below threshold', () => {
    const result = service.calculateFare({ distanceKm: 0 });

    expect(result.baseFare).toBe(0);
    expect(result.discountAmount).toBe(0);
    expect(result.appFeeAmount).toBe(3000);
    expect(result.finalFare).toBe(3000);
  });

  it('throws when discount amount is invalid or exceeds base fare', () => {
    expect(() =>
      service.calculateFare({ distanceKm: 3, discountAmount: -10 }),
    ).toThrow(BadRequestException);
    expect(() =>
      service.calculateFare({ distanceKm: 1, discountAmount: 4000 }),
    ).toThrow(BadRequestException);
  });

  it('returns null for invalid estimated fare inputs and string for valid values', () => {
    expect(service.calculateEstimatedFare(undefined)).toBeNull();
    expect(service.calculateEstimatedFare(null)).toBeNull();
    expect(service.calculateEstimatedFare(NaN)).toBeNull();
    expect(service.calculateEstimatedFare(2)).toBe('6000.00');
  });
});
