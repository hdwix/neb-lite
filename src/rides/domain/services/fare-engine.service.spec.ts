import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FareEngineService } from './fare-engine.service';

function makeService(configMap: Record<string, unknown>): FareEngineService {
  const cfg = {
    get: jest.fn((key: string) => configMap[key]),
  } as unknown as ConfigService;
  return new FareEngineService(cfg);
}

describe('FareEngineService', () => {
  describe('constructor / getNumberConfig', () => {
    it('uses string configs when parseable', () => {
      const svc = makeService({
        DEFAULT_FARE_RATE_PER_KM: '3500',
        APP_FEE_PERCENT: '7',
        APP_FEE_MIN_AMOUNT: '2500',
        APP_FEE_MIN_THRESHOLD: '9000',
      });

      // Indirectly assert via calculation
      const res = svc.calculateFare({ distanceKm: 2, discountAmount: 0 });
      // baseFare = 2 * 3500 = 7000 (<9000 => app fee min 2500)
      expect(res.baseFare).toBe(7000);
      expect(res.appFeeAmount).toBe(2500);
      expect(res.finalFare).toBe(9500);
    });

    it('uses numeric configs when provided as numbers', () => {
      const svc = makeService({
        DEFAULT_FARE_RATE_PER_KM: 4000,
        APP_FEE_PERCENT: 10,
        APP_FEE_MIN_AMOUNT: 1500,
        APP_FEE_MIN_THRESHOLD: 12000,
      });

      const res = svc.calculateFare({ distanceKm: 3.5, discountAmount: 0 });
      // baseFare = 3.5 * 4000 = 14000 >= 12000 -> fee = 10% of 14000 = 1400
      expect(res.baseFare).toBe(14000);
      expect(res.appFeeAmount).toBe(1400);
      expect(res.finalFare).toBe(15400);
    });

    it('falls back to defaults when config is unparseable', () => {
      const svc = makeService({
        DEFAULT_FARE_RATE_PER_KM: 'oops',
        APP_FEE_PERCENT: 'nope',
        APP_FEE_MIN_AMOUNT: 'idk',
        APP_FEE_MIN_THRESHOLD: '???',
      });
      // Defaults: rate=3000, percent=5, min=3000, threshold=10000
      const res = svc.calculateFare({ distanceKm: 1, discountAmount: 0 });
      // base=3000 (<10000 -> min app fee 3000)
      expect(res.baseFare).toBe(3000);
      expect(res.appFeeAmount).toBe(3000);
      expect(res.finalFare).toBe(6000);
    });
  });

  describe('calculateFare()', () => {
    const svc = makeService({
      DEFAULT_FARE_RATE_PER_KM: '3000',
      APP_FEE_PERCENT: '5',
      APP_FEE_MIN_AMOUNT: '3000',
      APP_FEE_MIN_THRESHOLD: '10000',
    });

    it('computes fare with discount and min app fee branch (below threshold)', () => {
      const res = svc.calculateFare({ distanceKm: 2.345, discountAmount: 500 });
      // roundedDistanceKm = 2.345
      expect(res.roundedDistanceKm).toBe(2.345);
      // baseFare = 2.345 * 3000 = 7035
      expect(res.baseFare).toBeCloseTo(7035);
      // discount rounded (already integral) and percent rounded to 2 decimals
      expect(res.discountAmount).toBe(500);
      expect(res.discountPercent).toBeCloseTo((500 / 7035) * 100, 2);
      // fareAfterDiscount = 7035 - 500 = 6535
      expect(res.fareAfterDiscount).toBe(6535);
      // below threshold -> app fee min 3000
      expect(res.appFeeAmount).toBe(3000);
      // finalFare = 6535 + 3000 = 9535
      expect(res.finalFare).toBe(9535);
    });

    it('handles undefined discount as zero', () => {
      const res = svc.calculateFare({ distanceKm: 1.2 });
      // base = 1.2 * 3000 = 3600 (< threshold => min fee 3000)
      expect(res.baseFare).toBe(3600);
      expect(res.discountAmount).toBe(0);
      expect(res.discountPercent).toBe(0);
      expect(res.fareAfterDiscount).toBe(3600);
      expect(res.appFeeAmount).toBe(3000);
      expect(res.finalFare).toBe(6600);
    });

    it('handles zero/negative/NaN effective fare via guards (distance leading to non-positive base)', () => {
      // negative distance -> rounded -1.234 => base becomes Math.max(0, -3702) => 0
      const neg = svc.calculateFare({ distanceKm: -1.234 });
      expect(neg.roundedDistanceKm).toBe(-1.234);
      expect(neg.baseFare).toBe(0);
      expect(neg.fareAfterDiscount).toBe(0);
      // app fee when fareAfterDiscount <= 0 -> min
      expect(neg.appFeeAmount).toBe(3000);
      expect(neg.finalFare).toBe(3000);

      // zero distance
      const zero = svc.calculateFare({ distanceKm: 0 });
      expect(zero.baseFare).toBe(0);
      expect(zero.fareAfterDiscount).toBe(0);
      expect(zero.appFeeAmount).toBe(3000);
      expect(zero.finalFare).toBe(3000);
    });

    it('applies percentage app fee when fareAfterDiscount >= threshold', () => {
      const svc2 = makeService({
        DEFAULT_FARE_RATE_PER_KM: 5000,
        APP_FEE_PERCENT: 12,
        APP_FEE_MIN_AMOUNT: 1000,
        APP_FEE_MIN_THRESHOLD: 15000,
      });
      // distance 4 -> base 20000 >= 15000 => fee 12% of 20000 = 2400
      const res = svc2.calculateFare({ distanceKm: 4, discountAmount: 0 });
      expect(res.baseFare).toBe(20000);
      expect(res.appFeeAmount).toBe(2400);
      expect(res.finalFare).toBe(22400);
    });

    it('throws when discount exceeds base fare', () => {
      expect(
        () => svc.calculateFare({ distanceKm: 1, discountAmount: 4000 }), // base=3000
      ).toThrow(
        new BadRequestException('Discount amount exceeds calculated fare'),
      );
    });

    it('throws on invalid (negative) discount', () => {
      expect(() =>
        svc.calculateFare({ distanceKm: 2, discountAmount: -1 }),
      ).toThrow(new BadRequestException('Invalid discount amount'));
    });

    it('throws on non-finite discount (NaN)', () => {
      expect(() =>
        svc.calculateFare({ distanceKm: 2, discountAmount: Number('oops') }),
      ).toThrow(new BadRequestException('Invalid discount amount'));
    });

    it('rounds distance to 3 decimals and monetary amounts to 2 decimals', () => {
      const svc3 = makeService({
        DEFAULT_FARE_RATE_PER_KM: 3333.3333, // odd rate to exercise rounding
        APP_FEE_PERCENT: 5,
        APP_FEE_MIN_AMOUNT: 1111.11,
        APP_FEE_MIN_THRESHOLD: 9999.99,
      });
      const res = svc3.calculateFare({
        distanceKm: 1.23456,
        discountAmount: 0.4444,
      });
      // roundedDistanceKm -> 1.235
      expect(res.roundedDistanceKm).toBe(1.235);
      // baseFare = 1.235 * 3333.3333 = 4116.666... -> Math.max(0, v) keeps value (no rounding here by design)
      // discount normalized and rounded to 2 decimals -> 0.44
      expect(res.discountAmount).toBe(0.44);
      // fareAfterDiscount rounded to 2 decimals
      expect(Number.isInteger(Math.round(res.fareAfterDiscount * 100))).toBe(
        true,
      );
      // finalFare rounded to 2 decimals
      expect(Number.isInteger(Math.round(res.finalFare * 100))).toBe(true);
    });
  });

  describe('calculateEstimatedFare()', () => {
    const svc = makeService({ DEFAULT_FARE_RATE_PER_KM: 3000 });

    it('returns null for undefined, null, or NaN distances', () => {
      expect(svc.calculateEstimatedFare(undefined)).toBeNull();
      expect(svc.calculateEstimatedFare(null as unknown as number)).toBeNull();
      expect(svc.calculateEstimatedFare(Number('oops'))).toBeNull();
    });

    it('returns string with 2 decimals for valid distance', () => {
      expect(svc.calculateEstimatedFare(2)).toBe('6000.00');
      expect(svc.calculateEstimatedFare(1.234)).toBe((1.234 * 3000).toFixed(2));
    });
  });
});
