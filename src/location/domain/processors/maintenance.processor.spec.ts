import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { MaintenanceProcessor } from './maintenance.processor';
import { MaintenanceJob } from '../services/location.types';

type MockRedisInstance = {
  zrangebyscore: jest.Mock;
  multi: jest.Mock;
  multiReturn: {
    zrem: jest.Mock;
    del: jest.Mock;
    hdel: jest.Mock;
    exec: jest.Mock;
  };
  on: jest.Mock;
};

const redisInstances: MockRedisInstance[] = [];

jest.mock('ioredis', () => {
  const MockRedis = jest.fn().mockImplementation(() => {
    const exec = jest.fn().mockResolvedValue([]);
    const multiReturn = {
      zrem: jest.fn().mockReturnThis(),
      del: jest.fn().mockReturnThis(),
      hdel: jest.fn().mockReturnThis(),
      exec,
    } as MockRedisInstance['multiReturn'];

    const instance: MockRedisInstance = {
      zrangebyscore: jest.fn(),
      multi: jest.fn().mockReturnValue(multiReturn),
      multiReturn,
      on: jest.fn(),
    };

    redisInstances.push(instance);
    return instance;
  });

  return { __esModule: true, default: MockRedis };
});

describe('MaintenanceProcessor', () => {
  const configService = {
    get: jest.fn().mockImplementation((key: string, fallback?: any) => {
      if (key === 'REDIS_HOST') return 'localhost';
      if (key === 'REDIS_PORT') return 6379;
      return fallback;
    }),
  } as unknown as ConfigService;

  beforeEach(() => {
    redisInstances.length = 0;
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const setupProcessor = () => {
    const processor = new MaintenanceProcessor(configService);
    const redis = redisInstances[redisInstances.length - 1];

    return {
      processor,
      zrangebyscore: redis.zrangebyscore,
      multiReturn: redis.multiReturn,
      exec: redis.multiReturn.exec,
    };
  };

  it('cleans up stale drivers and stops when none left', async () => {
    const { processor, zrangebyscore, multiReturn } = setupProcessor();
    zrangebyscore
      .mockResolvedValueOnce(['id-1', 'id-2'])
      .mockResolvedValueOnce([]);

    await processor.process({ name: MaintenanceJob.CleanupIdleDrivers } as any);

    expect(zrangebyscore).toHaveBeenCalled();
    expect(multiReturn.zrem).toHaveBeenCalledWith(
      'drivers:active',
      'id-1',
      'id-2',
    );
    expect(multiReturn.zrem).toHaveBeenCalledWith(
      'drivers:geo',
      'id-1',
      'id-2',
    );
    expect(multiReturn.del).toHaveBeenCalledWith('driver:loc:id-1');
    expect(multiReturn.del).toHaveBeenCalledWith('driver:loc:id-2');
    expect(multiReturn.hdel).toHaveBeenCalledWith(
      'geo:drivers:metadata',
      'id-1',
      'id-2',
    );
  });

  it('skips non-cleanup jobs', async () => {
    const { processor, zrangebyscore } = setupProcessor();

    await processor.process({ name: 'other-job' } as any);

    expect(zrangebyscore).not.toHaveBeenCalled();
  });

  it('continues processing when a full batch is returned', async () => {
    const { processor, zrangebyscore, exec } = setupProcessor();
    const fullBatch = Array.from(
      { length: 1000 },
      (_, index) => `id-${index.toString().padStart(3, '0')}`,
    );

    zrangebyscore
      .mockResolvedValueOnce(fullBatch)
      .mockResolvedValueOnce(['last-id'])
      .mockResolvedValueOnce([]);

    await processor.process({ name: MaintenanceJob.CleanupIdleDrivers } as any);

    expect(zrangebyscore).toHaveBeenCalledTimes(2);
    expect(exec).toHaveBeenCalledTimes(2);
  });

  it('exits immediately when no stale drivers exist', async () => {
    const { processor, zrangebyscore, multiReturn } = setupProcessor();
    zrangebyscore.mockResolvedValueOnce([]);

    await processor.process({ name: MaintenanceJob.CleanupIdleDrivers } as any);

    expect(zrangebyscore).toHaveBeenCalledTimes(1);
    expect(multiReturn.exec).not.toHaveBeenCalled();
    expect(multiReturn.zrem).not.toHaveBeenCalled();
    expect(multiReturn.hdel).not.toHaveBeenCalled();
  });

  it('logs redis connection errors', () => {
    const logErrorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation();

    setupProcessor();
    const redis = redisInstances[redisInstances.length - 1];
    const [, errorHandler] = redis.on.mock.calls.find(
      ([event]) => event === 'error',
    )!;

    errorHandler('boom');

    expect(logErrorSpy).toHaveBeenCalledWith('Redis connection error: boom');
  });
});
