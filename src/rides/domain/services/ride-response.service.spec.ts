import { ConfigService } from '@nestjs/config';
import { RideResponseService } from './ride-response.service';
import { ERideStatus } from '../constants/ride-status.enum';

describe('RideResponseService', () => {
  const configService = { get: jest.fn() } as unknown as ConfigService;
  let service: RideResponseService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new RideResponseService(configService);
  });

  it('computes fare breakdown when distanceActualKm is present', () => {
    const ride = {
      id: 'ride-1',
      riderId: 'r1',
      driverId: 'd1',
      pickupLongitude: 106.8,
      pickupLatitude: -6.2,
      dropoffLongitude: 106.9,
      dropoffLatitude: -6.3,
      status: ERideStatus.CANDIDATES_COMPUTED,
      fareEstimated: 10000,
      fareFinal: null,
      distanceEstimatedKm: 3.2,
      durationEstimatedSeconds: 600,
      distanceActualKm: 2.345,
      discountPercent: null,
      discountAmount: 500,
      appFeeAmount: '1000',
      paymentUrl: null,
      paymentStatus: null,
      createdAt: new Date('2025-01-01T00:00:00Z'),
    } as any;

    const candidates = [
      {
        driverId: 'D-01',
        status: 'PENDING',
        reason: null,
        distanceMeters: 321,
        respondedAt: new Date('2025-01-01T00:05:00Z'),
        createdAt: new Date('2025-01-01T00:01:00Z'),
      },
      {
        driverId: 'D-02',
        status: 'REJECTED',
        reason: 'Far',
        distanceMeters: 700,
        respondedAt: null,
        createdAt: new Date('2025-01-01T00:02:00Z'),
      },
    ] as any[];

    const res = service.toRideResponse(ride, candidates);

    expect(res.baseFare).toBe('7035.00');
    expect(res.fareRatePerKm).toBe(3000);
    expect(res.discountAmountByDriver).toBe('500.00');
    expect(res.fareAfterDiscount).toBe('6535.00');
    expect(res.finalFare).toBe('7535.00');
    expect(res.candidates).toEqual([
      {
        driverId: 'D-01',
        status: 'PENDING',
        reason: null,
        distanceMeters: 321,
        respondedAt: '2025-01-01T00:05:00.000Z',
        createdAt: '2025-01-01T00:01:00.000Z',
      },
      {
        driverId: 'D-02',
        status: 'REJECTED',
        reason: 'Far',
        distanceMeters: 700,
        respondedAt: null,
        createdAt: '2025-01-01T00:02:00.000Z',
      },
    ]);
  });

  it('omits candidates and fare breakdown when data is missing', () => {
    const ride = {
      id: 'ride-2',
      riderId: 'r1',
      driverId: 'd1',
      pickupLongitude: 1,
      pickupLatitude: 1,
      dropoffLongitude: 2,
      dropoffLatitude: 2,
      status: ERideStatus.COMPLETED,
      distanceActualKm: null,
      createdAt: '2025-01-02T00:00:00Z',
    } as any;

    const res = service.toRideResponse(ride);

    expect(res.candidates).toBeUndefined();
    expect(res.baseFare).toBeUndefined();
  });

  it('preserves raw fareFinal when currency parsing fails', () => {
    const ride = {
      id: 'ride-raw',
      riderId: 'r1',
      driverId: 'd1',
      pickupLongitude: 0,
      pickupLatitude: 0,
      dropoffLongitude: 0,
      dropoffLatitude: 0,
      status: ERideStatus.CANDIDATES_COMPUTED,
      distanceActualKm: null,
      fareFinal: 'oops',
      createdAt: '2025-01-05T00:00:00Z',
    } as any;

    const res = service.toRideResponse(ride);

    expect(res.finalFare).toBeUndefined();
    expect(res.fareFinal).toBe('oops');
  });

  it('normalizes negative currency values and candidate timestamps', () => {
    const ride = {
      id: 'ride-neg',
      riderId: 'r1',
      driverId: 'd1',
      pickupLongitude: 106.7,
      pickupLatitude: -6.2,
      dropoffLongitude: 106.8,
      dropoffLatitude: -6.3,
      status: ERideStatus.CANDIDATES_COMPUTED,
      distanceActualKm: 1,
      discountAmount: -200,
      appFeeAmount: -100,
      createdAt: '2025-01-06T00:00:00Z',
    } as any;

    const candidates = [
      {
        driverId: 'D-STR',
        status: 'PENDING',
        reason: null,
        distanceMeters: 123,
        respondedAt: '2025-01-06T00:05:00.000Z',
        createdAt: '2025-01-06T00:01:00.000Z',
      },
      {
        driverId: 'D-UNDEF',
        status: 'REJECTED',
        reason: 'Busy',
        distanceMeters: 456,
        respondedAt: undefined,
        createdAt: undefined,
      },
    ] as any[];

    const res = service.toRideResponse(ride, candidates);

    expect(res.baseFare).toBe('3000.00');
    expect(res.discountAmountByDriver).toBe('0.00');
    expect(res.fareAfterDiscount).toBe('3000.00');
    expect(res.finalFare).toBe('3000.00');
    expect(res.candidates).toEqual([
      {
        driverId: 'D-STR',
        status: 'PENDING',
        reason: null,
        distanceMeters: 123,
        respondedAt: '2025-01-06T00:05:00.000Z',
        createdAt: '2025-01-06T00:01:00.000Z',
      },
      {
        driverId: 'D-UNDEF',
        status: 'REJECTED',
        reason: 'Busy',
        distanceMeters: 456,
        respondedAt: null,
        createdAt: null,
      },
    ]);
  });
});
