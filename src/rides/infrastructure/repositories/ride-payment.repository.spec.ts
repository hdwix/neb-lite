import { RidePaymentRepository } from './ride-payment.repository';

describe('RidePaymentRepository', () => {
  const dataSource = {
    query: jest.fn(),
    createQueryRunner: jest.fn(),
  } as any;
  let repository: RidePaymentRepository;

  beforeEach(() => {
    jest.clearAllMocks();
    repository = new RidePaymentRepository(dataSource);
  });

  it('returns null when ride not found', async () => {
    dataSource.query.mockResolvedValue([]);
    await expect(repository.findById('1')).resolves.toBeNull();
  });

  it('maps ride row fields', async () => {
    dataSource.query.mockResolvedValue([
      {
        id: '1',
        riderId: '2',
        driverId: null,
        pickupLongitude: '1.23',
        pickupLatitude: '4.56',
        dropoffLongitude: '7.89',
        dropoffLatitude: '0.12',
        status: 'completed',
        discountPercent: '5',
        distanceEstimatedKm: '12',
        durationEstimatedSeconds: '100',
        distanceActualKm: '11',
        createdAt: new Date().toISOString(),
      },
    ]);

    const ride = await repository.findById('1');
    expect(ride?.id).toBe('1');
    expect(ride?.pickupLongitude).toBeCloseTo(1.23);
    expect(ride?.discountPercent).toBe(5);
  });

  it('updates payment state successfully', async () => {
    dataSource.query.mockResolvedValue([{}]);

    await repository.updatePaymentState('1', 'paid', 'url');

    expect(dataSource.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE rides'),
      ['1', 'paid', 'url'],
    );
  });

  it('throws when updatePaymentState finds no ride', async () => {
    dataSource.query.mockResolvedValue([]);

    await expect(
      repository.updatePaymentState('1', 'paid', null),
    ).rejects.toThrow('Ride not found while updating payment state');
  });

  it('bubbles up query failures when updating payment state', async () => {
    dataSource.query.mockRejectedValue(new Error('db unavailable'));

    await expect(
      repository.updatePaymentState('22', 'pending', 'pay-url'),
    ).rejects.toThrow('db unavailable');
  });

  it('updates payment state using null fallbacks for missing values', async () => {
    dataSource.query.mockResolvedValue([{}]);

    await repository.updatePaymentState('10', null, undefined as any);

    expect(dataSource.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE rides'),
      ['10', null, null],
    );
  });

  it('returns null for unfinished rides when none found', async () => {
    dataSource.query.mockResolvedValue([]);

    const ride = await repository.findById('missing');
    expect(ride).toBeNull();
  });

  it('finds candidates for a ride and maps fields', async () => {
    const respondedAt = new Date('2024-05-01T10:00:00.000Z');
    const createdAt = new Date('2024-05-01T10:01:00.000Z');
    const createdAtSecond = new Date('2024-06-02T11:00:00.000Z');

    dataSource.query.mockResolvedValue([
      {
        driverId: '12',
        status: 'accepted',
        reason: 'nearby',
        distanceMeters: '1500',
        respondedAt: respondedAt.toISOString(),
        createdAt: createdAt.toISOString(),
      },
      {
        driverId: '45',
        status: 'declined',
        reason: null,
        distanceMeters: null,
        respondedAt: null,
        createdAt: createdAtSecond.toISOString(),
      },
    ]);

    const candidates = await (repository as any).findCandidatesForRide('99');

    expect(dataSource.query).toHaveBeenCalledWith(expect.any(String), ['99']);
    expect(candidates).toHaveLength(2);
    expect(candidates[0].driverId).toBe('12');
    expect(candidates[0].distanceMeters).toBe(1500);
    expect(candidates[0].respondedAt?.getTime()).toBe(respondedAt.getTime());
    expect(candidates[0].createdAt.getTime()).toBe(createdAt.getTime());
    expect(candidates[1].driverId).toBe('45');
    expect(candidates[1].reason).toBeNull();
    expect(candidates[1].distanceMeters).toBeUndefined();
    expect(candidates[1].respondedAt).toBeUndefined();
    expect(candidates[1].createdAt.getTime()).toBe(createdAtSecond.getTime());
  });

  it('returns empty array when no candidates are found', async () => {
    dataSource.query.mockResolvedValue(undefined);

    const candidates = await (repository as any).findCandidatesForRide('100');

    expect(candidates).toEqual([]);
  });

  it('maps ride rows with numeric conversions and defaults', () => {
    const toStringId = { toString: () => '55' } as any;
    const now = new Date('2024-07-01T12:00:00.000Z');

    const ride = (repository as any).mapRideRowToEntity({
      id: toStringId,
      riderId: '9',
      driverId: '15',
      status: 'in_progress',
      fareEstimated: '12.50',
      fareFinal: '15.75',
      discountPercent: '10',
      discountAmount: '1.5',
      appFeeAmount: '2.3',
      distanceEstimatedKm: '5.5',
      durationEstimatedSeconds: '600',
      distanceActualKm: '5.0',
      paymentUrl: 'http://pay.test',
      paymentStatus: 'pending',
      createdAt: now.toISOString(),
    });

    expect(ride.id).toBe('55');
    expect(ride.riderId).toBe('9');
    expect(ride.driverId).toBe('15');
    expect(ride.status).toBe('in_progress');
    expect(ride.discountPercent).toBe(10);
    expect(ride.distanceEstimatedKm).toBe(5.5);
    expect(ride.durationEstimatedSeconds).toBe(600);
    expect(ride.distanceActualKm).toBe(5.0);
    expect(ride.paymentUrl).toBe('http://pay.test');
    expect(ride.paymentStatus).toBe('pending');
    expect(ride.createdAt?.getTime()).toBe(now.getTime());
  });

  describe('mapRideRowToEntity', () => {
    it('returns numeric coordinates when provided as strings', () => {
      const ride = (repository as any).mapRideRowToEntity({
        id: '200',
        riderId: '300',
        driverId: undefined,
        pickupLongitude: '10.01',
        pickupLatitude: '20.02',
        dropoffLongitude: '30.03',
        dropoffLatitude: '40.04',
        status: 'requested',
      });

      expect(ride.id).toBe('200');
      expect(ride.riderId).toBe('300');
      expect(ride.driverId).toBeNull();
      expect(ride.pickupLongitude).toBeCloseTo(10.01);
      expect(ride.pickupLatitude).toBeCloseTo(20.02);
      expect(ride.dropoffLongitude).toBeCloseTo(30.03);
      expect(ride.dropoffLatitude).toBeCloseTo(40.04);
      expect(ride.status).toBe('requested');
    });

    it('preserves nullish fallbacks for optional values', () => {
      const ride = (repository as any).mapRideRowToEntity({
        id: null,
        riderId: null,
        driverId: null,
        pickupLongitude: null,
        pickupLatitude: undefined,
        dropoffLongitude: null,
        dropoffLatitude: undefined,
        discountPercent: null,
        discountAmount: undefined,
        appFeeAmount: null,
        distanceEstimatedKm: null,
        durationEstimatedSeconds: undefined,
        distanceActualKm: null,
        paymentUrl: undefined,
        paymentStatus: undefined,
        createdAt: null,
      });

      expect(ride.id).toBeNull();
      expect(ride.riderId).toBeNull();
      expect(ride.driverId).toBeNull();
      expect(ride.pickupLongitude).toBeUndefined();
      expect(ride.pickupLatitude).toBeUndefined();
      expect(ride.dropoffLongitude).toBeUndefined();
      expect(ride.dropoffLatitude).toBeUndefined();
      expect(ride.discountPercent).toBeNull();
      expect(ride.discountAmount).toBeUndefined();
      expect(ride.appFeeAmount).toBeUndefined();
      expect(ride.distanceEstimatedKm).toBeNull();
      expect(ride.durationEstimatedSeconds).toBeNull();
      expect(ride.distanceActualKm).toBeNull();
      expect(ride.paymentUrl).toBeNull();
      expect(ride.paymentStatus).toBeNull();
      expect(ride.createdAt).toBeUndefined();
    });
  });

  describe('mapCandidateRow', () => {
    it('converts primitive fields to expected types', () => {
      const respondedAt = new Date('2024-08-01T09:30:00.000Z');
      const createdAt = new Date('2024-08-01T09:45:00.000Z');

      const candidate = (repository as any).mapCandidateRow({
        driverId: '777',
        status: 'accepted',
        reason: 'closest driver',
        distanceMeters: '3210',
        respondedAt: respondedAt.toISOString(),
        createdAt: createdAt.toISOString(),
      });

      expect(candidate.driverId).toBe('777');
      expect(candidate.status).toBe('accepted');
      expect(candidate.reason).toBe('closest driver');
      expect(candidate.distanceMeters).toBe(3210);
      expect(candidate.respondedAt?.getTime()).toBe(respondedAt.getTime());
      expect(candidate.createdAt?.getTime()).toBe(createdAt.getTime());
    });

    it('leaves optional fields undefined when row provides nullish values', () => {
      const candidate = (repository as any).mapCandidateRow({
        driverId: null,
        status: undefined,
        reason: undefined,
        distanceMeters: undefined,
        respondedAt: null,
        createdAt: null,
      });

      expect(candidate.driverId).toBeUndefined();
      expect(candidate.status).toBeUndefined();
      expect(candidate.reason).toBeNull();
      expect(candidate.distanceMeters).toBeUndefined();
      expect(candidate.respondedAt).toBeUndefined();
      expect(candidate.createdAt).toBeUndefined();
    });
  });
});
