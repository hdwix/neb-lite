import { RideRepository } from './ride.repository';
import { ERideStatus } from '../../domain/constants/ride-status.enum';
import { ERideDriverCandidateStatus } from '../../domain/constants/ride-driver-candidate-status.enum';

const createRunner = () =>
  ({
    connect: jest.fn(),
    startTransaction: jest.fn(),
    commitTransaction: jest.fn(),
    rollbackTransaction: jest.fn(),
    release: jest.fn(),
    query: jest.fn(),
    isTransactionActive: false,
    isReleased: false,
  }) as any;

describe('RideRepository', () => {
  const dataSource = {
    query: jest.fn(),
    createQueryRunner: jest.fn(),
  } as any;
  let repository: RideRepository;

  beforeEach(() => {
    jest.clearAllMocks();
    repository = new RideRepository(dataSource);
  });

  it('creates ride from partial data', () => {
    const ride = repository.create({ riderId: '1' } as any);
    expect(ride.riderId).toBe('1');
  });

  it('claims driver when available', async () => {
    const runner = createRunner();
    runner.startTransaction.mockImplementation(() => {
      runner.isTransactionActive = true;
    });
    runner.query
      .mockResolvedValueOnce([{ driver_id: null }])
      .mockResolvedValueOnce([{ id: '1' }]);
    dataSource.createQueryRunner.mockReturnValue(runner);

    const claimed = await repository.claimDriver('1', '2');

    expect(claimed).toBe(true);
    expect(runner.commitTransaction).toHaveBeenCalled();
  });

  it('throws when ride already claimed', async () => {
    const runner = createRunner();
    runner.startTransaction.mockImplementation(() => {
      runner.isTransactionActive = true;
    });
    runner.rollbackTransaction.mockImplementation(() => {
      runner.isTransactionActive = false;
    });
    runner.query.mockResolvedValueOnce([{ driver_id: '3' }]);
    dataSource.createQueryRunner.mockReturnValue(runner);

    await expect(repository.claimDriver('1', '2')).rejects.toThrow(
      'Ride already claimed',
    );
    expect(runner.rollbackTransaction).toHaveBeenCalled();
  });

  it('throws when ride missing while claiming', async () => {
    const runner = createRunner();
    runner.startTransaction.mockImplementation(() => {
      runner.isTransactionActive = true;
    });
    runner.rollbackTransaction.mockImplementation(() => {
      runner.isTransactionActive = false;
    });
    runner.query.mockResolvedValueOnce([]);
    dataSource.createQueryRunner.mockReturnValue(runner);

    await expect(repository.claimDriver('1', '2')).rejects.toThrow(
      'Ride not found',
    );
    expect(runner.rollbackTransaction).toHaveBeenCalled();
    expect(runner.release).toHaveBeenCalled();
  });

  it('findById returns null when missing', async () => {
    dataSource.query.mockResolvedValue([]);
    await expect(repository.findById('1')).resolves.toBeNull();
  });

  it('maps ride row with fallback values', async () => {
    dataSource.query.mockResolvedValue([
      {
        id: '1',
        rider_id: '2',
        driver_id: null,
        pickup_lon: 1,
        pickup_lat: 2,
        dropoff_lon: 3,
        dropoff_lat: 4,
        status: 'unknown',
        discount_percent: null,
        distance_estimated_km: null,
        duration_estimated_seconds: null,
        distance_actual_km: null,
        created_at: new Date().toISOString(),
      },
    ]);

    const ride = await repository.findById('1');
    expect(ride?.status).toBe(ERideStatus.REQUESTED);
    expect(ride?.pickupLatitude).toBe(2);
  });

  it('findUnfinishedRideByRiderId maps row', async () => {
    dataSource.query.mockResolvedValue([
      { id: '1', rider_id: '2', status: ERideStatus.ACCEPTED },
    ]);
    const ride = await repository.findUnfinishedRideByRiderId('2');
    expect(ride?.status).toBe(ERideStatus.ACCEPTED);
  });

  it('findUnfinishedRideByRiderId returns null when none found', async () => {
    dataSource.query.mockResolvedValueOnce([]);
    await expect(
      repository.findUnfinishedRideByRiderId('2'),
    ).resolves.toBeNull();
  });

  it('updateRide merges and persists changes', async () => {
    const base = {
      id: '1',
      rider_id: '2',
      pickup_lon: 1,
      pickup_lat: 2,
      dropoff_lon: 3,
      dropoff_lat: 4,
      status: ERideStatus.REQUESTED,
    };
    dataSource.query
      .mockResolvedValueOnce([base])
      .mockResolvedValueOnce([{ id: '1' }])
      .mockResolvedValueOnce([{ ...base, status: ERideStatus.ENROUTE }]);

    const result = await repository.updateRide({
      id: '1',
      status: ERideStatus.ENROUTE,
    } as any);

    expect(result.status).toBe(ERideStatus.ENROUTE);
  });

  it('updateRide throws when id missing', async () => {
    await expect(repository.updateRide({} as any)).rejects.toThrow(
      'Ride id is required for updates',
    );
  });

  it('updateRide throws when update returns no rows', async () => {
    const base = {
      id: '1',
      rider_id: '2',
      pickup_lon: 1,
      pickup_lat: 2,
      dropoff_lon: 3,
      dropoff_lat: 4,
      status: ERideStatus.REQUESTED,
    };
    jest
      .spyOn(repository, 'findById')
      .mockResolvedValueOnce(repository['mapRideRow'](base as any))
      .mockResolvedValueOnce(repository['mapRideRow'](base as any));
    dataSource.query.mockResolvedValueOnce([]);

    await expect(repository.updateRide({ id: '1' } as any)).rejects.toThrow(
      'Ride not found while updating',
    );
  });

  it('updateRide throws when ride missing after update', async () => {
    const base = {
      id: '1',
      rider_id: '2',
      pickup_lon: 1,
      pickup_lat: 2,
      dropoff_lon: 3,
      dropoff_lat: 4,
      status: ERideStatus.REQUESTED,
    };
    jest
      .spyOn(repository, 'findById')
      .mockResolvedValueOnce(repository['mapRideRow'](base as any))
      .mockResolvedValueOnce(null);
    dataSource.query.mockResolvedValueOnce([{ id: '1' }]);

    await expect(repository.updateRide({ id: '1' } as any)).rejects.toThrow(
      'Ride not found after update',
    );
  });

  it('updateRide throws when ride missing', async () => {
    dataSource.query.mockResolvedValueOnce([]);
    await expect(repository.updateRide({ id: '1' } as any)).rejects.toThrow(
      'Ride not found while updating',
    );
  });

  it('remove returns ride when no id', async () => {
    const ride: any = { riderId: '1' };
    const removed = await repository.remove(ride);
    expect(removed).toBe(ride);
  });

  it('remove deletes ride when id is present', async () => {
    const ride: any = { id: '42', riderId: '1' };
    const removed = await repository.remove(ride);

    expect(dataSource.query).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM rides'),
      ['42'],
    );
    expect(removed).toBe(ride);
  });

  it('createRideWithDetails persists ride, candidates, and history', async () => {
    const runner = createRunner();
    runner.startTransaction.mockImplementation(() => {
      runner.isTransactionActive = true;
    });
    runner.commitTransaction.mockImplementation(() => {
      runner.isTransactionActive = false;
    });
    const nowIso = new Date().toISOString();
    runner.query
      .mockResolvedValueOnce([{ id: '10' }])
      .mockResolvedValueOnce([
        {
          id: 'c1',
          ride_id: '10',
          driver_id: '2',
          status: ERideDriverCandidateStatus.INVITED,
          distance_meters: '100',
          responded_at: null,
          created_at: nowIso,
        },
      ])
      .mockResolvedValueOnce([{ id: 'history-1' }]);
    dataSource.createQueryRunner.mockReturnValue(runner);
    dataSource.query.mockResolvedValueOnce([
      {
        id: '10',
        rider_id: '1',
        status: ERideStatus.REQUESTED,
        pickup_lon: 1,
        pickup_lat: 2,
        dropoff_lon: 3,
        dropoff_lat: 4,
        created_at: nowIso,
      },
    ]);

    const result = await repository.createRideWithDetails({
      ride: {
        riderId: '1',
        pickupLongitude: 1,
        pickupLatitude: 2,
        dropoffLongitude: 3,
        dropoffLatitude: 4,
        status: ERideStatus.REQUESTED,
      },
      nearbyDrivers: [{ driverId: '2', distanceMeters: 100.4 }],
      historyEntries: [{ fromStatus: null, toStatus: ERideStatus.REQUESTED }],
    });

    expect(result.ride.id).toBe('10');
    expect(result.candidates[0].distanceMeters).toBe(100);
    expect(runner.commitTransaction).toHaveBeenCalled();
  });

  it('createRideWithDetails works with default optional arrays', async () => {
    const runner = createRunner();
    runner.startTransaction.mockImplementation(() => {
      runner.isTransactionActive = true;
    });
    runner.commitTransaction.mockImplementation(() => {
      runner.isTransactionActive = false;
    });
    runner.query.mockResolvedValueOnce([{ id: 44 as any }]);
    dataSource.createQueryRunner.mockReturnValue(runner);
    jest
      .spyOn(repository, 'findById')
      .mockResolvedValueOnce({ id: '44' } as any);

    const result = await repository.createRideWithDetails({
      ride: {
        riderId: '2',
        pickupLongitude: 10,
        pickupLatitude: 20,
        dropoffLongitude: 30,
        dropoffLatitude: 40,
        status: ERideStatus.REQUESTED,
      },
      nearbyDrivers: [],
      historyEntries: [],
    });

    expect(result.ride.id).toBe('44');
    expect(runner.query).not.toHaveBeenCalledWith(
      expect.stringContaining('ride_driver_candidates'),
      expect.any(Array),
    );
  });

  it('createRideWithDetails normalizes ride id with custom toString and skips null nearby drivers', async () => {
    const runner = createRunner();
    runner.startTransaction.mockImplementation(() => {
      runner.isTransactionActive = true;
    });
    runner.commitTransaction.mockImplementation(() => {
      runner.isTransactionActive = false;
    });

    const rideId = { toString: () => '777' } as any;
    runner.query.mockResolvedValueOnce([{ id: rideId }]);
    dataSource.createQueryRunner.mockReturnValue(runner);
    jest
      .spyOn(repository, 'findById')
      .mockResolvedValueOnce({ id: '777' } as any);

    const result = await repository.createRideWithDetails({
      ride: {
        riderId: '9',
        pickupLongitude: 1,
        pickupLatitude: 2,
        dropoffLongitude: 3,
        dropoffLatitude: 4,
        status: ERideStatus.REQUESTED,
      },
      nearbyDrivers: null as any,
      historyEntries: [],
    });

    expect(result.ride.id).toBe('777');
    expect(runner.query).not.toHaveBeenCalledWith(
      expect.stringContaining('ride_driver_candidates'),
      expect.any(Array),
    );
  });

  it('createRideWithDetails throws when ride insert returns empty', async () => {
    const runner = createRunner();
    runner.startTransaction.mockImplementation(() => {
      runner.isTransactionActive = true;
    });
    runner.rollbackTransaction.mockImplementation(() => {
      runner.isTransactionActive = false;
    });
    runner.release.mockImplementation(() => {
      runner.isReleased = true;
    });
    runner.query.mockResolvedValueOnce([]);
    dataSource.createQueryRunner.mockReturnValue(runner);

    await expect(
      repository.createRideWithDetails({
        ride: {
          riderId: '1',
          pickupLongitude: 1,
          pickupLatitude: 2,
          dropoffLongitude: 3,
          dropoffLatitude: 4,
          status: ERideStatus.REQUESTED,
        },
        nearbyDrivers: [],
        historyEntries: [],
      }),
    ).rejects.toThrow('Failed to create ride');

    expect(runner.rollbackTransaction).toHaveBeenCalled();
    expect(runner.release).toHaveBeenCalled();
  });

  it('createRideWithDetails throws when ride fails to load after creation', async () => {
    const runner = createRunner();
    runner.startTransaction.mockImplementation(() => {
      runner.isTransactionActive = true;
    });
    runner.commitTransaction.mockImplementation(() => {
      runner.isTransactionActive = false;
    });
    runner.release.mockImplementation(() => {
      runner.isReleased = true;
    });
    runner.query.mockResolvedValueOnce([{ id: '10' }]).mockResolvedValue([]);
    dataSource.createQueryRunner.mockReturnValue(runner);
    jest.spyOn(repository, 'findById').mockResolvedValueOnce(null);

    await expect(
      repository.createRideWithDetails({
        ride: {
          riderId: '1',
          pickupLongitude: 1,
          pickupLatitude: 2,
          dropoffLongitude: 3,
          dropoffLatitude: 4,
          status: ERideStatus.REQUESTED,
        },
        nearbyDrivers: [],
        historyEntries: [],
      }),
    ).rejects.toThrow('Failed to load ride after creation');

    expect(runner.commitTransaction).toHaveBeenCalled();
    expect(runner.release).toHaveBeenCalled();
  });

  it('mapRideRow handles alternative coordinate property names', () => {
    const ride = (repository as any).mapRideRow({
      id: '1',
      rider_id: '2',
      pickupLongitude: '5.5',
      pickupLatitude: '6.6',
      dropoffLongitude: '7.7',
      dropoffLatitude: '8.8',
    });

    expect(ride.pickupLongitude).toBe(5.5);
    expect(ride.pickupLatitude).toBe(6.6);
    expect(ride.dropoffLongitude).toBe(7.7);
    expect(ride.dropoffLatitude).toBe(8.8);
  });

  it('createRideWithDetails rolls back on error', async () => {
    const runner = createRunner();
    runner.startTransaction.mockImplementation(() => {
      runner.isTransactionActive = true;
    });
    runner.rollbackTransaction.mockImplementation(() => {
      runner.isTransactionActive = false;
    });
    runner.release.mockImplementation(() => {
      runner.isReleased = true;
    });
    runner.query.mockRejectedValue(new Error('insert failed'));
    dataSource.createQueryRunner.mockReturnValue(runner);

    await expect(
      repository.createRideWithDetails({
        ride: {
          riderId: '1',
          pickupLongitude: 1,
          pickupLatitude: 2,
          dropoffLongitude: 3,
          dropoffLatitude: 4,
          status: ERideStatus.REQUESTED,
        },
        nearbyDrivers: [],
        historyEntries: [],
      }),
    ).rejects.toThrow('insert failed');

    expect(runner.rollbackTransaction).toHaveBeenCalled();
  });

  it('createRideWithDetails normalizes ride id and null candidate distances', async () => {
    const runner = createRunner();
    runner.startTransaction.mockImplementation(() => {
      runner.isTransactionActive = true;
    });
    runner.commitTransaction.mockImplementation(() => {
      runner.isTransactionActive = false;
    });
    const numericId = 33 as any;
    runner.query
      .mockResolvedValueOnce([{ id: numericId }])
      .mockResolvedValueOnce([
        {
          id: 'c1',
          ride_id: '33',
          driver_id: '9',
          status: ERideDriverCandidateStatus.INVITED,
          distance_meters: null,
          responded_at: null,
          created_at: new Date().toISOString(),
        },
      ]);
    dataSource.createQueryRunner.mockReturnValue(runner);
    jest
      .spyOn(repository, 'findById')
      .mockResolvedValueOnce({ id: '33' } as any);

    const result = await repository.createRideWithDetails({
      ride: {
        riderId: '1',
        pickupLongitude: 1,
        pickupLatitude: 2,
        dropoffLongitude: 3,
        dropoffLatitude: 4,
        status: ERideStatus.REQUESTED,
      },
      nearbyDrivers: [{ driverId: '9', distanceMeters: null as any }],
      historyEntries: [],
    });

    expect(runner.query).toHaveBeenCalledWith(expect.any(String), [
      '33',
      '9',
      ERideDriverCandidateStatus.INVITED,
      null,
    ]);
    expect(result.ride.id).toBe('33');
    expect(result.candidates[0].distanceMeters).toBeNull();
  });

  it('mapCandidateRow handles underscore property names', () => {
    const now = new Date();
    const candidate = (repository as any).mapCandidateRow({
      id: '7',
      ride_id: '8',
      driver_id: '9',
      status: ERideDriverCandidateStatus.ACCEPTED,
      distance_meters: '123',
      reason: 'ok',
      responded_at: now.toISOString(),
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
    });

    expect(candidate.distanceMeters).toBe(123);
    expect(candidate.respondedAt?.toISOString()).toBe(now.toISOString());
    expect(candidate.createdAt?.toISOString()).toBe(now.toISOString());
    expect(candidate.updatedAt?.toISOString()).toBe(now.toISOString());
  });

  it('mapCandidateRow normalizes camelCase ids without snake_case fallbacks', () => {
    const candidate = (repository as any).mapCandidateRow({
      id: 100 as any,
      rideId: 200 as any,
      driverId: 300 as any,
      status: ERideDriverCandidateStatus.INVITED,
    });

    expect(candidate.id).toBe('100');
    expect(candidate.rideId).toBe('200');
    expect(candidate.driverId).toBe('300');
    expect(candidate.status).toBe(ERideDriverCandidateStatus.INVITED);
  });

  it('mapCandidateRow handles camelCase property names', () => {
    const respondedAt = new Date('2020-01-01T00:00:00Z');
    const createdAt = new Date('2020-01-02T00:00:00Z');
    const candidate = (repository as any).mapCandidateRow({
      id: '11',
      rideId: '22',
      driverId: '33',
      status: ERideDriverCandidateStatus.INVITED,
      distanceMeters: undefined,
      reason: null,
      respondedAt: respondedAt.toISOString(),
      createdAt: createdAt.toISOString(),
    });

    expect(candidate.rideId).toBe('22');
    expect(candidate.driverId).toBe('33');
    expect(candidate.respondedAt?.toISOString()).toBe(
      respondedAt.toISOString(),
    );
    expect(candidate.createdAt?.toISOString()).toBe(createdAt.toISOString());
    expect(candidate.updatedAt).toBeUndefined();
  });

  it('mapCandidateRow normalizes ids and updatedAt from camelCase', () => {
    const updatedAt = new Date('2020-01-04T00:00:00Z');
    const candidate = (repository as any).mapCandidateRow({
      id: 21 as any,
      rideId: 22 as any,
      driverId: 33 as any,
      status: ERideDriverCandidateStatus.DECLINED,
      updatedAt: updatedAt.toISOString(),
    });

    expect(candidate.id).toBe('21');
    expect(candidate.rideId).toBe('22');
    expect(candidate.driverId).toBe('33');
    expect(candidate.status).toBe(ERideDriverCandidateStatus.DECLINED);
    expect(candidate.updatedAt?.toISOString()).toBe(updatedAt.toISOString());
  });

  it('mapCandidateRow falls back to nulls and preserves provided status', () => {
    const candidate = (repository as any).mapCandidateRow({
      id: 99 as any,
      ride_id: 101 as any,
      driver_id: 202 as any,
      status: ERideDriverCandidateStatus.ACCEPTED,
      respondedAt: undefined,
      createdAt: undefined,
      updatedAt: undefined,
    });

    expect(candidate.id).toBe('99');
    expect(candidate.rideId).toBe('101');
    expect(candidate.driverId).toBe('202');
    expect(candidate.status).toBe(ERideDriverCandidateStatus.ACCEPTED);
    expect(candidate.respondedAt).toBeNull();
    expect(candidate.createdAt).toBeUndefined();
    expect(candidate.updatedAt).toBeUndefined();
  });

  it('mapRideRow converts camelCase numeric and date fields', () => {
    const ride = (repository as any).mapRideRow({
      id: '55',
      rider_id: '99',
      pickupLongitude: '10.1',
      pickupLatitude: '11.2',
      dropoffLongitude: '12.3',
      dropoffLatitude: '13.4',
      status: ERideStatus.ACCEPTED,
      discountPercent: '12.5',
      discountAmount: '1.5',
      appFeeAmount: '0.5',
      distanceEstimatedKm: '2.2',
      durationEstimatedSeconds: '600',
      distanceActualKm: '1.1',
      paymentUrl: 'http://pay',
      paymentStatus: 'paid',
      note: 'note',
      cancelReason: 'none',
      createdAt: '2020-01-01T00:00:00.000Z',
      updatedAt: '2020-01-02T00:00:00.000Z',
      deletedAt: '2020-01-03T00:00:00.000Z',
    });

    expect(ride.discountPercent).toBe(12.5);
    expect(ride.distanceEstimatedKm).toBe(2.2);
    expect(ride.durationEstimatedSeconds).toBe(600);
    expect(ride.distanceActualKm).toBe(1.1);
    expect(ride.createdAt?.toISOString()).toBe('2020-01-01T00:00:00.000Z');
    expect(ride.updatedAt?.toISOString()).toBe('2020-01-02T00:00:00.000Z');
    expect(ride.deletedAt?.toISOString()).toBe('2020-01-03T00:00:00.000Z');
  });

  it('mapRideRow converts underscore numeric fields and dates', () => {
    const ride = (repository as any).mapRideRow({
      id: 77,
      rider_id: 88,
      driver_id: 99,
      pickup_lon: '1.1',
      pickup_lat: '2.2',
      dropoff_lon: '3.3',
      dropoff_lat: '4.4',
      status: 'in_progress',
      discount_percent: '15',
      discount_amount: '4.5',
      app_fee_amount: '2.5',
      distance_estimated_km: '6.7',
      duration_estimated_seconds: '1234',
      distance_actual_km: '5.6',
      payment_url: 'http://pay.me',
      payment_status: 'pending',
      note: 'note',
      cancel_reason: 'none',
      created_at: '2021-01-01T00:00:00.000Z',
      updated_at: '2021-01-02T00:00:00.000Z',
      deleted_at: '2021-01-03T00:00:00.000Z',
    });

    expect(ride.id).toBe('77');
    expect(ride.riderId).toBe('88');
    expect(ride.driverId).toBe('99');
    expect(ride.pickupLongitude).toBe(1.1);
    expect(ride.pickupLatitude).toBe(2.2);
    expect(ride.dropoffLongitude).toBe(3.3);
    expect(ride.dropoffLatitude).toBe(4.4);
    expect(ride.status).toBe(ERideStatus.REQUESTED);
    expect(ride.discountPercent).toBe(15);
    expect(ride.discountAmount).toBe('4.5');
    expect(ride.appFeeAmount).toBe('2.5');
    expect(ride.distanceEstimatedKm).toBe(6.7);
    expect(ride.durationEstimatedSeconds).toBe(1234);
    expect(ride.distanceActualKm).toBe(5.6);
    expect(ride.paymentUrl).toBe('http://pay.me');
    expect(ride.paymentStatus).toBe('pending');
    expect(ride.note).toBe('note');
    expect(ride.cancelReason).toBe('none');
    expect(ride.createdAt?.toISOString()).toBe('2021-01-01T00:00:00.000Z');
    expect(ride.updatedAt?.toISOString()).toBe('2021-01-02T00:00:00.000Z');
    expect(ride.deletedAt?.toISOString()).toBe('2021-01-03T00:00:00.000Z');
  });

  it('mapRideRow normalizes camelCase ids when snake_case is absent', () => {
    const ride = (repository as any).mapRideRow({
      id: 501 as any,
      riderId: 601 as any,
      driverId: 701 as any,
      status: ERideStatus.ACCEPTED,
      pickupLongitude: 9,
      pickupLatitude: 8,
      dropoffLongitude: 7,
      dropoffLatitude: 6,
    });

    expect(ride.id).toBe('501');
    expect(ride.riderId).toBe('601');
    expect(ride.driverId).toBe('701');
    expect(ride.status).toBe(ERideStatus.ACCEPTED);
  });

  it('mapRideRow uses camelCase numeric and date fallbacks when snake_case is missing', () => {
    const createdAt = new Date('2022-02-01T00:00:00.000Z');
    const updatedAt = new Date('2022-02-02T00:00:00.000Z');
    const deletedAt = new Date('2022-02-03T00:00:00.000Z');
    const ride = (repository as any).mapRideRow({
      id: 801 as any,
      riderId: 901 as any,
      driverId: 1001 as any,
      status: ERideStatus.ENROUTE,
      pickupLongitude: '10.5',
      pickupLatitude: '11.6',
      dropoffLongitude: '12.7',
      dropoffLatitude: '13.8',
      distanceEstimatedKm: '1.4',
      durationEstimatedSeconds: '78',
      distanceActualKm: '2.5',
      createdAt: createdAt.toISOString(),
      updatedAt: updatedAt.toISOString(),
      deletedAt: deletedAt.toISOString(),
    });

    expect(ride.id).toBe('801');
    expect(ride.riderId).toBe('901');
    expect(ride.driverId).toBe('1001');
    expect(ride.pickupLongitude).toBe(10.5);
    expect(ride.pickupLatitude).toBe(11.6);
    expect(ride.dropoffLongitude).toBe(12.7);
    expect(ride.dropoffLatitude).toBe(13.8);
    expect(ride.distanceEstimatedKm).toBe(1.4);
    expect(ride.durationEstimatedSeconds).toBe(78);
    expect(ride.distanceActualKm).toBe(2.5);
    expect(ride.createdAt?.toISOString()).toBe(createdAt.toISOString());
    expect(ride.updatedAt?.toISOString()).toBe(updatedAt.toISOString());
    expect(ride.deletedAt?.toISOString()).toBe(deletedAt.toISOString());
  });
});
