import { RideResponseService } from './ride-response.service';
import { ERideStatus } from '../constants/ride-status.enum';

describe('RideResponseService', () => {
  let service: RideResponseService;

  beforeEach(() => {
    service = new RideResponseService();
  });

  it('returns ride details and candidates without recalculating fares', () => {
    const ride = {
      id: 'ride-1',
      riderId: 'r1',
      driverId: 'd1',
      pickupLongitude: 106.8,
      pickupLatitude: -6.2,
      dropoffLongitude: 106.9,
      dropoffLatitude: -6.3,
      status: ERideStatus.CANDIDATES_COMPUTED,
      fareEstimated: '10000.00',
      fareFinal: '7035.00',
      distanceEstimatedKm: 3.2,
      durationEstimatedSeconds: 600,
      distanceActualKm: 2.345,
      discountPercent: 10,
      discountAmount: '500.00',
      appFeeAmount: '1000.00',
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

    expect(res).toMatchObject({
      fareEstimated: '10000.00',
      fareFinal: '7035.00',
      distanceActualKm: 2.345,
      discountAmount: '500.00',
      appFeeAmount: '1000.00',
    });
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
    expect(res.fareFinal).toBeNull();
  });

  it('passes through raw fare values', () => {
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

    expect(res.fareFinal).toBe('oops');
  });

  it('normalizes candidate timestamps', () => {
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
