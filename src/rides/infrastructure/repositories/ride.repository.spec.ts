import { RideRepository } from './ride.repository';
import { ERideStatus } from '../../domain/constants/ride-status.enum';
import { ERideDriverCandidateStatus } from '../../domain/constants/ride-driver-candidate-status.enum';

const createRunner = () => ({
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

    await expect(repository.claimDriver('1', '2')).rejects.toThrow('Ride already claimed');
    expect(runner.rollbackTransaction).toHaveBeenCalled();
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
    dataSource.query.mockResolvedValue([{ id: '1', rider_id: '2', status: ERideStatus.ACCEPTED }]);
    const ride = await repository.findUnfinishedRideByRiderId('2');
    expect(ride?.status).toBe(ERideStatus.ACCEPTED);
  });

  it('updateRide merges and persists changes', async () => {
    const base = { id: '1', rider_id: '2', pickup_lon: 1, pickup_lat: 2, dropoff_lon: 3, dropoff_lat: 4, status: ERideStatus.REQUESTED };
    dataSource.query
      .mockResolvedValueOnce([base])
      .mockResolvedValueOnce([{ id: '1' }])
      .mockResolvedValueOnce([{ ...base, status: ERideStatus.ENROUTE }]);

    const result = await repository.updateRide({ id: '1', status: ERideStatus.ENROUTE } as any);

    expect(result.status).toBe(ERideStatus.ENROUTE);
  });

  it('updateRide throws when ride missing', async () => {
    dataSource.query.mockResolvedValueOnce([]);
    await expect(repository.updateRide({ id: '1' } as any)).rejects.toThrow('Ride not found while updating');
  });

  it('remove returns ride when no id', async () => {
    const ride: any = { riderId: '1' };
    const removed = await repository.remove(ride);
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
});
