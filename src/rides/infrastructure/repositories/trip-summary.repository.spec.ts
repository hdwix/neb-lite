import { TripSummaryRepository } from './trip-summary.repository';
import { EClientType } from '../../../app/enums/client-type.enum';

describe('TripSummaryRepository', () => {
  const dataSource = { query: jest.fn() } as any;
  let repository: TripSummaryRepository;

  beforeEach(() => {
    jest.clearAllMocks();
    repository = new TripSummaryRepository(dataSource);
  });

  it('returns early when no summaries', async () => {
    await repository.upsertSummaries([]);
    expect(dataSource.query).not.toHaveBeenCalled();
  });

  it('delegates to manager when provided', async () => {
    const manager = { query: jest.fn() } as any;

    await repository.upsertSummaries(
      [
        {
          rideId: '1',
          clientId: '2',
          clientRole: EClientType.RIDER,
          locationPayload: {
            longitude: 1,
            latitude: 2,
            recordedAt: new Date().toISOString(),
          },
          totalDistanceMeters: 10,
        },
      ],
      manager,
    );

    expect(manager.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO trip_summary'), expect.any(Array));
  });

  it('uses datasource when manager not provided', async () => {
    await repository.upsertSummaries([
      {
        rideId: '1',
        clientId: '2',
        clientRole: EClientType.DRIVER,
        locationPayload: null,
        totalDistanceMeters: null,
      },
    ]);

    expect(dataSource.query).toHaveBeenCalled();
  });
});
