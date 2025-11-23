import {
  ConflictException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { DataSource, EntityManager, QueryRunner } from 'typeorm';
import { DriverProfileRepository } from './driver-profile.repository';

describe('DriverProfileRepository', () => {
  let dataSource: jest.Mocked<DataSource>;
  let queryRunner: QueryRunner;
  let repository: DriverProfileRepository;
  let manager: jest.Mocked<EntityManager>;

  const createQueryRunner = () => {
    let transactionActive = false;
    let released = false;

    manager = {
      query: jest.fn(),
    } as unknown as jest.Mocked<EntityManager>;

    queryRunner = {
      manager,
      query: jest.fn(),
      connect: jest.fn().mockResolvedValue(undefined),
      startTransaction: jest.fn().mockImplementation(() => {
        transactionActive = true;
      }),
      commitTransaction: jest.fn().mockImplementation(() => {
        transactionActive = false;
      }),
      rollbackTransaction: jest.fn().mockImplementation(() => {
        transactionActive = false;
      }),
      release: jest.fn().mockImplementation(() => {
        released = true;
      }),
      get isTransactionActive() {
        return transactionActive;
      },
      get isReleased() {
        return released;
      },
      data: {},
      beforeMigration: jest.fn(),
      afterMigration: jest.fn(),
      withQueryRunner: jest.fn(),
    } as unknown as QueryRunner;
  };

  beforeEach(() => {
    createQueryRunner();
    dataSource = {
      query: jest.fn(),
      createQueryRunner: jest.fn().mockReturnValue(queryRunner),
    } as unknown as jest.Mocked<DataSource>;

    repository = new DriverProfileRepository(dataSource);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(jest.fn());
    jest.spyOn(Logger.prototype, 'error').mockImplementation(jest.fn());
    jest.spyOn(Logger.prototype, 'debug').mockImplementation(jest.fn());
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(jest.fn());
  });

  it('creates a driver profile under advisory lock and returns the driver', async () => {
    (queryRunner.query as jest.Mock).mockImplementation((sql: string) => {
      if (sql.includes('pg_try_advisory_lock')) {
        return Promise.resolve([{ acquired: true }]);
      }
      if (sql.includes('pg_advisory_unlock')) {
        return Promise.resolve([{ released: true }]);
      }
      return Promise.resolve([]);
    });
    manager.query.mockResolvedValue([
      { id: '1', msisdn: '123', role: 'driver' },
    ] as any);

    const result = await repository.createDriverProfileWithLock(
      '123',
      'DL123',
      'PLATE',
      'Jane',
      async (mgr) => {
        await mgr.query('before insert');
      },
    );

    expect(result).toEqual({ id: '1', msisdn: '123', role: 'driver' });
    expect(queryRunner.connect).toHaveBeenCalled();
    expect(queryRunner.startTransaction).toHaveBeenCalled();
    expect(queryRunner.commitTransaction).toHaveBeenCalled();
    expect(queryRunner.release).toHaveBeenCalled();
    expect(manager.query).toHaveBeenCalledWith('before insert');
  });

  it('throws ConflictException when advisory lock not acquired', async () => {
    (queryRunner.query as jest.Mock).mockResolvedValueOnce([
      { acquired: false },
    ]);

    await expect(
      repository.createDriverProfileWithLock('123', null, null, null),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(queryRunner.rollbackTransaction).not.toHaveBeenCalled();
    expect(queryRunner.release).toHaveBeenCalled();
  });

  it('throws InternalServerErrorException when insert returns no driver', async () => {
    (queryRunner.query as jest.Mock).mockResolvedValue([{ acquired: true }]);
    manager.query.mockResolvedValue([] as any);

    await expect(
      repository.createDriverProfileWithLock('123', null, null, null),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
    expect(queryRunner.rollbackTransaction).toHaveBeenCalled();
    expect(queryRunner.release).toHaveBeenCalled();
  });

  it('wraps unexpected errors with InternalServerErrorException', async () => {
    (queryRunner.query as jest.Mock).mockResolvedValue([{ acquired: true }]);
    manager.query.mockRejectedValue(new Error('boom'));

    await expect(
      repository.createDriverProfileWithLock('123', null, null, null),
    ).rejects.toThrow('Failed to create driver profile');
    expect(queryRunner.rollbackTransaction).toHaveBeenCalled();
  });

  it('upserts driver by phone and logs errors', async () => {
    await repository.upsertDriverByPhone('555');
    expect(Logger.prototype.log).toHaveBeenCalledWith(
      'process upsert for phone number : 555',
    );
    expect(dataSource.query).toHaveBeenCalled();

    (dataSource.query as jest.Mock).mockRejectedValue(new Error('fail'));
    await repository.upsertDriverByPhone('999');
    expect(Logger.prototype.error).toHaveBeenCalledWith('fail');
  });

  it('finds driver by phone using provided manager', async () => {
    const externalManager = {
      query: jest.fn().mockResolvedValue(['driver']),
    } as any;
    const result = await repository.findDriverByPhone('123', externalManager);
    expect(result).toEqual(['driver']);
    expect(externalManager.query).toHaveBeenCalled();
    expect(dataSource.query).not.toHaveBeenCalled();
  });

  it('finds driver by phone using data source when no manager provided', async () => {
    dataSource.query.mockResolvedValue(['driver'] as any);
    const result = await repository.findDriverByPhone('123');
    expect(result).toEqual(['driver']);
    expect(dataSource.query).toHaveBeenCalled();
  });

  it('finds driver by id', async () => {
    dataSource.query.mockResolvedValue(['driver-by-id'] as any);
    const result = await repository.findDriverbyId('id');
    expect(result).toEqual(['driver-by-id']);
    expect(dataSource.query).toHaveBeenCalled();
  });
});
