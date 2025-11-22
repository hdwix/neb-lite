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

    const result = await repository.save(
      repository.create({ driverId: '20' }),
      '10',
    );

    expect(result.id).toBe('1');
    expect(dataSource.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO ride_driver_candidates'),
      expect.any(Array),
    );
  });

  it('saves existing candidate via update', async () => {
    const row = createRow();
    dataSource.query.mockResolvedValue([row]);

    const result = await repository.save(
      repository.create({ id: '1', driverId: '20', rideId: '10' }),
    );

    expect(result.id).toBe('1');
    expect(dataSource.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE ride_driver_candidates'),
      expect.any(Array),
    );
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

  it('saveMany persists every candidate with provided ride id', async () => {
    dataSource.query
      .mockResolvedValueOnce([createRow()])
      .mockResolvedValueOnce([{ ...createRow(), id: 2 }]);

    const candidates = [
      repository.create({ driverId: '20' }),
      repository.create({ driverId: '21' }),
    ];

    const results = await repository.saveMany(candidates, '10');

    expect(results).toHaveLength(2);
    expect(results[0].id).toBe('1');
    expect(results[1].id).toBe('2');
    expect(dataSource.query).toHaveBeenCalledTimes(2);
  });

  it('finds by ride id and maps rows', async () => {
    dataSource.query.mockResolvedValue([createRow(), createRow()]);

    const results = await repository.findByRideId('10');

    expect(results).toHaveLength(2);
    expect(results[0].distanceMeters).toBe(100);
  });

  it('returns empty array when no rows found for ride id', async () => {
    dataSource.query.mockResolvedValue(undefined as any);

    const results = await repository.findByRideId('10');

    expect(results).toEqual([]);
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
      repository.save(
        repository.create({ id: '1', driverId: '20', rideId: '10' }),
      ),
    ).rejects.toThrow('Ride driver candidate not found while updating');
  });

  it('throws when update is called without id', async () => {
    await expect(
      (repository as any).updateCandidate(
        repository.create({ driverId: '20', rideId: '10' }),
      ),
    ).rejects.toThrow('Candidate id is required for updates');
    expect(dataSource.query).not.toHaveBeenCalled();
  });

  describe('mapRowToEntity', () => {
    it('maps database row to candidate entity with conversions', () => {
      const result = (repository as any).mapRowToEntity(createRow());

      expect(result).toBeInstanceOf(RideDriverCandidate);
      expect(result.id).toBe('1');
      expect(result.rideId).toBe('10');
      expect(result.driverId).toBe('20');
      expect(result.status).toBe('invited');
      expect(result.distanceMeters).toBe(100);
      expect(result.reason).toBe('nearby');
      expect(result.respondedAt).toEqual(new Date('2023-01-01T00:00:00Z'));
      expect(result.createdAt).toEqual(new Date('2023-01-01T00:00:00Z'));
      expect(result.updatedAt).toEqual(new Date('2023-01-02T00:00:00Z'));
    });

    it('handles nullable and alternative source fields', () => {
      const row = {
        id: undefined,
        ride_id: undefined,
        driverId: '30',
        status: undefined,
        distance_meters: undefined,
        reason: undefined,
        responded_at: null,
        created_at: null,
        updated_at: null,
      } as any;

      const result = (repository as any).mapRowToEntity(row);

      expect(result.id).toBeNull();
      expect(result.rideId).toBeNull();
      expect(result.driverId).toBe('30');
      expect(result.status).toBeNull();
      expect(result.distanceMeters).toBeNull();
      expect(result.reason).toBeNull();
      expect(result.respondedAt).toBeNull();
      expect(result.createdAt).toBeUndefined();
      expect(result.updatedAt).toBeUndefined();
    });

    it('uses driverId column when driver_id is absent', () => {
      const row = {
        driverId: null,
      } as any;

      const result = (repository as any).mapRowToEntity(row);

      expect(result.driverId).toBeNull();
    });
  });
});
