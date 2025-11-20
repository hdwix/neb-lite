import { RideDriverCandidateRepository } from './ride-driver-candidate.repository';
import { RideDriverCandidate } from '../../domain/entities/ride-driver-candidate.entity';

const createRow = () => ({
  id: 1,
  ride_id: 10,
  driver_id: 20,
  status: 'invited',
  distance_meters: '100',
  reason: 'nearby',
  responded_at: '2023-01-01T00:00:00Z',
  created_at: '2023-01-01T00:00:00Z',
  updated_at: '2023-01-02T00:00:00Z',
});

describe('RideDriverCandidateRepository', () => {
  const dataSource = {
    query: jest.fn(),
  } as any;
  let repository: RideDriverCandidateRepository;

  beforeEach(() => {
    jest.clearAllMocks();
    repository = new RideDriverCandidateRepository(dataSource);
  });

  it('creates candidate from partial data', () => {
    const candidate = repository.create({ driverId: '1' });
    expect(candidate).toBeInstanceOf(RideDriverCandidate);
    expect(candidate.driverId).toBe('1');
  });

  it('saves new candidate and uses provided ride id', async () => {
    const row = createRow();
    dataSource.query.mockResolvedValue([row]);

    const result = await repository.save(repository.create({ driverId: '20' }), '10');

    expect(result.id).toBe('1');
    expect(dataSource.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO ride_driver_candidates'), expect.any(Array));
  });

  it('saves existing candidate via update', async () => {
    const row = createRow();
    dataSource.query.mockResolvedValue([row]);

    const result = await repository.save(
      repository.create({ id: '1', driverId: '20', rideId: '10' }),
    );

    expect(result.id).toBe('1');
    expect(dataSource.query).toHaveBeenCalledWith(expect.stringContaining('UPDATE ride_driver_candidates'), expect.any(Array));
  });

  it('throws when ride id missing for insert', async () => {
    await expect(
      repository.save(repository.create({ driverId: '20' })),
    ).rejects.toThrow('Ride id is required for ride driver candidates');
  });

  it('saveMany returns empty when no candidates', async () => {
    const result = await repository.saveMany([]);
    expect(result).toEqual([]);
    expect(dataSource.query).not.toHaveBeenCalled();
  });

  it('finds by ride id and maps rows', async () => {
    dataSource.query.mockResolvedValue([createRow(), createRow()]);

    const results = await repository.findByRideId('10');

    expect(results).toHaveLength(2);
    expect(results[0].distanceMeters).toBe(100);
  });

  it('finds by ride and driver or returns null', async () => {
    dataSource.query.mockResolvedValue([]);
    const missing = await repository.findByRideAndDriver('1', '2');
    expect(missing).toBeNull();

    dataSource.query.mockResolvedValue([createRow()]);
    const found = await repository.findByRideAndDriver('1', '2');
    expect(found?.driverId).toBe('20');
  });

  it('throws when insert returns no rows', async () => {
    dataSource.query.mockResolvedValueOnce([]);

    await expect(
      repository.save(repository.create({ driverId: '20', rideId: '10' })),
    ).rejects.toThrow('Failed to create ride driver candidate');
  });

  it('throws when update returns no rows', async () => {
    dataSource.query.mockResolvedValueOnce([]);

    await expect(
      repository.save(repository.create({ id: '1', driverId: '20', rideId: '10' })),
    ).rejects.toThrow('Ride driver candidate not found while updating');
  });
});
