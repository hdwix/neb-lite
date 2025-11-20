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
});
