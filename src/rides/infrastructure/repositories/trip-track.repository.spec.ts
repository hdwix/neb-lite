import { TripTrackRepository } from './trip-track.repository';
import { TripSummaryRepository } from './trip-summary.repository';
import { EClientType } from '../../../app/enums/client-type.enum';

const createRunner = () => ({
  connect: jest.fn(),
  startTransaction: jest.fn(),
  commitTransaction: jest.fn(),
  rollbackTransaction: jest.fn(),
  release: jest.fn(),
  manager: { query: jest.fn() },
  isTransactionActive: false,
  isReleased: false,
}) as any;

describe('TripTrackRepository', () => {
  const dataSource = {
    createQueryRunner: jest.fn(),
  } as any;
  const tripSummaryRepository: jest.Mocked<TripSummaryRepository> = {
    upsertSummaries: jest.fn(),
  } as any;
  let repository: TripTrackRepository;

  beforeEach(() => {
    jest.clearAllMocks();
    repository = new TripTrackRepository(dataSource, tripSummaryRepository);
  });

  it('does nothing when no entries and summaries', async () => {
    await repository.persistFlush([], []);
    expect(dataSource.createQueryRunner).not.toHaveBeenCalled();
  });

  it('persists entries and summaries transactionally', async () => {
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
    dataSource.createQueryRunner.mockReturnValue(runner);
    runner.manager.query.mockResolvedValueOnce(undefined);
    tripSummaryRepository.upsertSummaries.mockResolvedValue();

    await repository.persistFlush(
      [
        {
          rideId: '1',
          clientId: '2',
          clientRole: EClientType.RIDER,
          longitude: 1,
          latitude: 2,
          distanceDeltaMeters: 5,
          totalDistanceMeters: 10,
          recordedAt: new Date(),
          id: 'track-1',
          createdAt: new Date(),
        },
      ],
      [
        {
          rideId: '1',
          clientId: '2',
          clientRole: EClientType.RIDER,
          locationPayload: null,
          totalDistanceMeters: 10,
        },
      ],
    );

    expect(runner.commitTransaction).toHaveBeenCalled();
    expect(tripSummaryRepository.upsertSummaries).toHaveBeenCalled();
  });

  it('rolls back on error during persist', async () => {
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
    dataSource.createQueryRunner.mockReturnValue(runner);
    runner.manager.query.mockRejectedValue(new Error('fail'));

    await expect(
      repository.persistFlush(
        [
          {
            rideId: '1',
            clientId: '2',
          clientRole: EClientType.RIDER,
          longitude: 1,
          latitude: 2,
          distanceDeltaMeters: 5,
          totalDistanceMeters: 10,
          recordedAt: new Date(),
          id: 'track-2',
          createdAt: new Date(),
        },
      ],
        [],
      ),
    ).rejects.toThrow('fail');

    expect(runner.rollbackTransaction).toHaveBeenCalled();
    expect(runner.isReleased).toBe(true);
  });

  it('buildInsertManyStatement returns sql and parameters', () => {
    const { sql, parameters } = (repository as any).buildInsertManyStatement([
      {
        rideId: '1',
        clientId: '2',
        clientRole: EClientType.RIDER,
        longitude: 1,
        latitude: 2,
        distanceDeltaMeters: 3,
        totalDistanceMeters: 4,
        recordedAt: new Date('2023-01-01T00:00:00Z'),
        id: 'track-3',
        createdAt: new Date('2023-01-01T00:00:00Z'),
      },
    ]);

    expect(sql).toContain('INSERT INTO trip_track');
    expect(parameters).toHaveLength(8);
    expect(parameters[0]).toBe('1');
  });
});
