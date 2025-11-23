import { RideStatusHistoryRepository } from './ride-status-history.repository';

describe('RideStatusHistoryRepository', () => {
  const dataSource = { query: jest.fn() } as any;
  let repository: RideStatusHistoryRepository;

  beforeEach(() => {
    jest.clearAllMocks();
    repository = new RideStatusHistoryRepository(dataSource);
  });

  it('creates entity from partial', () => {
    const history = repository.create({
      rideId: '1',
      toStatus: 'completed',
    } as any);
    expect(history.toStatus).toBe('completed');
  });

  it('saves and maps row', async () => {
    dataSource.query.mockResolvedValue([
      {
        id: 1,
        ride_id: 2,
        from_status: 'requested',
        to_status: 'accepted',
        context: 'manual',
        created_at: '2023-01-01T00:00:00Z',
      },
    ]);

    const saved = await repository.save(
      repository.create({ rideId: '2', toStatus: 'accepted' } as any),
    );

    expect(saved.id).toBe('1');
    expect(saved.fromStatus).toBe('requested');
  });

  it('throws when save returns no rows', async () => {
    dataSource.query.mockResolvedValue([]);

    await expect(
      repository.save(
        repository.create({ rideId: '2', toStatus: 'accepted' } as any),
      ),
    ).rejects.toThrow('Failed to persist ride status history');
  });

  describe('mapRowToEntity', () => {
    it('maps row values to entity defaults', () => {
      const row = {
        id: 10,
        ride_id: 20,
        to_status: 'accepted',
        context: undefined,
        created_at: '2023-01-02T00:00:00Z',
      } as any;

      const history = (repository as any).mapRowToEntity(row);

      expect(history.id).toBe('10');
      expect(history.rideId).toBe('20');
      expect(history.fromStatus).toBeNull();
      expect(history.context).toBeNull();
      expect(history.createdAt).toEqual(new Date('2023-01-02T00:00:00Z'));
    });

    it('converts identifiers to strings and keeps createdAt when missing', () => {
      const row = {
        id: { toString: jest.fn().mockReturnValue('15') },
        ride_id: { toString: jest.fn().mockReturnValue('25') },
        to_status: 'cancelled',
      } as any;

      const history = (repository as any).mapRowToEntity(row);

      expect(row.id.toString).toHaveBeenCalled();
      expect(row.ride_id.toString).toHaveBeenCalled();
      expect(history.id).toBe('15');
      expect(history.rideId).toBe('25');
      expect(history.toStatus).toBe('cancelled');
      expect(history.createdAt).toBeUndefined();
    });

    it('preserves status and context values when provided', () => {
      const row = {
        id: 5,
        ride_id: 6,
        from_status: 'requested',
        to_status: 'ongoing',
        context: 'system-update',
        created_at: '2023-01-03T00:00:00Z',
      } as any;

      const history = (repository as any).mapRowToEntity(row);

      expect(history.fromStatus).toBe('requested');
      expect(history.toStatus).toBe('ongoing');
      expect(history.context).toBe('system-update');
      expect(history.createdAt).toEqual(new Date('2023-01-03T00:00:00Z'));
    });

    it('fallback to default value when undefined', () => {
      const row = {
        id: undefined,
        ride_id: undefined,
        from_status: undefined,
        to_status: undefined,
        context: undefined,
        created_at: '2023-01-03T00:00:00Z',
      } as any;

      const history = (repository as any).mapRowToEntity(row);

      expect(history.id).toBeNull();
      expect(history.rideId).toBeNull();
      expect(history.fromStatus).toBeNull();
      expect(history.toStatus).toBeNull();
      expect(history.context).toBeNull;
      expect(history.createdAt).toEqual(new Date('2023-01-03T00:00:00Z'));
    });
  });
});
