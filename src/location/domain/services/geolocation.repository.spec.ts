import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import {
  ACTIVE_DRIVER_LOC_ZSET,
  DRIVER_LOC_GEO_KEY,
  DRIVER_LOC_HASH_PREFIX,
  DRIVER_METADATA_HASH_KEY,
} from './location.types';
import { GeolocationRepository } from './geolocation.repository';

type MockRedis = jest.Mocked<Redis> & {
  __pipeline?: ReturnType<Redis['multi']>;
};

jest.mock('ioredis', () => ({
  __esModule: true,
  default: jest.fn(),
}));

describe('GeolocationRepository', () => {
  let redisInstance: MockRedis;
  let configService: { get: jest.Mock };
  let repository: GeolocationRepository;
  let pipeline: any;
  let execMock: jest.Mock;
  let georadiusMock: jest.Mock;
  let zmscoreMock: jest.Mock;
  let hmgetMock: jest.Mock;
  let quitMock: jest.Mock;

  beforeEach(() => {
    execMock = jest.fn().mockResolvedValue([]);
    georadiusMock = jest.fn();
    zmscoreMock = jest.fn();
    hmgetMock = jest.fn();
    quitMock = jest.fn().mockResolvedValue(undefined);

    pipeline = {
      geoadd: jest.fn().mockReturnThis(),
      hset: jest.fn().mockReturnThis(),
      expire: jest.fn().mockReturnThis(),
      zadd: jest.fn().mockReturnThis(),
      publish: jest.fn().mockReturnThis(),
      exec: execMock,
    };

    const RedisMock = Redis as unknown as jest.Mock;
    RedisMock.mockImplementation(() => {
      redisInstance = {
        on: jest.fn(),
        quit: quitMock,
        multi: jest.fn().mockReturnValue(pipeline),
        georadius: georadiusMock,
        zmscore: zmscoreMock,
        hmget: hmgetMock,
      } as unknown as MockRedis;
      return redisInstance;
    });

    configService = {
      get: jest.fn((key: string, defaultValue?: any) => {
        const map: Record<string, any> = {
          REDIS_HOST: 'localhost',
          REDIS_PORT: 6379,
          DRIVER_LOCATION_TTL_SECONDS: undefined,
        };
        return key in map ? map[key] : defaultValue;
      }),
    } as unknown as ConfigService as any;

    jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.resetAllMocks();
  });

  it('logs redis connection errors from the error event', () => {
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();

    repository = new GeolocationRepository(
      configService as unknown as ConfigService,
    );

    const errorHandler = redisInstance.on.mock.calls[0][1];
    errorHandler(new Error('boom'));

    expect(redisInstance.on).toHaveBeenCalledWith(
      'error',
      expect.any(Function),
    );
    expect(errorSpy).toHaveBeenCalledWith('Redis connection error: Error: boom');
  });

  it('stores driver locations with pipeline and default TTL', async () => {
    const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();

    repository = new GeolocationRepository(
      configService as unknown as ConfigService,
    );

    const timestamp = '2024-01-01T00:00:00.000Z';
    await repository.storeDriverLocation(
      'driver-1',
      { longitude: 10, latitude: 20, accuracyMeters: 5 },
      timestamp,
    );

    expect(redisInstance.multi).toHaveBeenCalled();
    expect(pipeline.geoadd).toHaveBeenCalledWith(
      DRIVER_LOC_GEO_KEY,
      10,
      20,
      'driver-1',
    );
    expect(pipeline.hset).toHaveBeenCalledWith(
      `${DRIVER_LOC_HASH_PREFIX}driver-1`,
      {
        longitude: '10',
        latitude: '20',
        accuracyMeters: '5',
        updatedAt: timestamp,
      },
    );
    expect(pipeline.expire).toHaveBeenCalledWith(
      `${DRIVER_LOC_HASH_PREFIX}driver-1`,
      300,
    );
    expect(pipeline.zadd).toHaveBeenCalledWith(
      ACTIVE_DRIVER_LOC_ZSET,
      expect.any(Number),
      'driver-1',
    );
    expect(pipeline.publish).toHaveBeenCalledWith(
      'drivers:loc:updates',
      JSON.stringify({
        driverId: 'driver-1',
        longitude: 10,
        latitude: 20,
        accuracyMeters: 5,
        updatedAt: timestamp,
      }),
    );
    expect(execMock).toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(
      'success store update location data for driverId: driver-1',
    );
  });

  it('uses current timestamp when eventTimestamp is not provided', async () => {
    const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2025-03-04T05:06:07.000Z'));

    repository = new GeolocationRepository(
      configService as unknown as ConfigService,
    );

    await repository.storeDriverLocation('driver-3', {
      longitude: 1,
      latitude: 2,
    });

    expect(pipeline.hset).toHaveBeenCalledWith(
      `${DRIVER_LOC_HASH_PREFIX}driver-3`,
      expect.objectContaining({
        updatedAt: '2025-03-04T05:06:07.000Z',
      }),
    );
    expect(pipeline.publish).toHaveBeenCalledWith(
      'drivers:loc:updates',
      JSON.stringify({
        driverId: 'driver-3',
        longitude: 1,
        latitude: 2,
        accuracyMeters: undefined,
        updatedAt: '2025-03-04T05:06:07.000Z',
      }),
    );
    expect(logSpy).toHaveBeenCalledWith(
      'success store update location data for driverId: driver-3',
    );

    jest.useRealTimers();
  });

  it('clamps TTL when configured below threshold and handles quit errors', async () => {
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    configService.get = jest.fn((key: string, defaultValue?: any) => {
      const map: Record<string, any> = {
        DRIVER_LOCATION_TTL_SECONDS: '120',
      };
      return key in map ? map[key] : defaultValue;
    });

    repository = new GeolocationRepository(
      configService as unknown as ConfigService,
    );

    const timestamp = '2024-02-02T00:00:00.000Z';
    await repository.storeDriverLocation(
      'driver-2',
      { longitude: 30, latitude: 40 },
      timestamp,
    );

    expect(pipeline.expire).toHaveBeenCalledWith(
      `${DRIVER_LOC_HASH_PREFIX}driver-2`,
      180,
    );

    quitMock.mockRejectedValueOnce(new Error('fail quit'));
    await repository.onModuleDestroy();
    expect(errorSpy).toHaveBeenCalledWith(
      'Failed to close redis connection: Error: fail quit',
    );
  });

  it('returns empty list when no active drivers are found', async () => {
    repository = new GeolocationRepository(
      configService as unknown as ConfigService,
    );
    georadiusMock.mockResolvedValueOnce([['driver-1', '10', ['1', '2']]]);
    zmscoreMock.mockResolvedValueOnce([null]);

    const results = await repository.getNearbyDrivers(1, 2, 1000, 5);

    expect(results).toEqual([]);
    expect(georadiusMock).toHaveBeenCalledWith(
      DRIVER_LOC_GEO_KEY,
      1,
      2,
      1000,
      'm',
      'WITHDIST',
      'WITHCOORD',
      'COUNT',
      5,
      'ASC',
    );
  });

  it('returns empty list when georadius has no results', async () => {
    repository = new GeolocationRepository(
      configService as unknown as ConfigService,
    );
    georadiusMock.mockResolvedValueOnce(null);

    const results = await repository.getNearbyDrivers(1, 1, 100, 1);

    expect(results).toEqual([]);
  });

  it('skips score lookup when georadius entries lack driver ids', async () => {
    repository = new GeolocationRepository(
      configService as unknown as ConfigService,
    );

    georadiusMock.mockResolvedValueOnce([[123, '50', ['10', '20']]]);

    const results = await repository.getNearbyDrivers(0, 0, 100, 1);

    expect(results).toEqual([]);
    expect(zmscoreMock).not.toHaveBeenCalled();
    expect(hmgetMock).not.toHaveBeenCalled();
  });

  it('maps nearby driver results and filters invalid entries', async () => {
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    repository = new GeolocationRepository(
      configService as unknown as ConfigService,
    );
    georadiusMock.mockResolvedValueOnce([
      ['driver-1', '100', ['106.8', '-6.2']],
      { 0: 'driver-legacy', 1: '120', 2: ['bad', 'coords'] },
      ['driver-2', '150', ['106.9', '-6.3']],
      [123, '200', ['107.0', '-6.4']],
    ]);
    zmscoreMock.mockResolvedValueOnce([1_000_100, 1_000_100, 1_000_100]);
    hmgetMock.mockResolvedValueOnce([
      JSON.stringify({ accuracyMeters: 3, updatedAt: 't1' }),
      'not-json',
      JSON.stringify({ accuracyMeters: 7, updatedAt: 't2' }),
    ]);

    const results = await repository.getNearbyDrivers(106.7, -6.1, 500, 10);

    expect(results).toEqual([
      {
        driverId: 'driver-1',
        distanceMeters: 100,
        location: { longitude: 106.8, latitude: -6.2 },
        metadata: { accuracyMeters: 3, updatedAt: 't1' },
      },
      {
        driverId: 'driver-2',
        distanceMeters: 150,
        location: { longitude: 106.9, latitude: -6.3 },
        metadata: { accuracyMeters: 7, updatedAt: 't2' },
      },
    ]);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        'Unable to parse metadata for driver driver-legacy',
      ),
    );
  });

  it('queries scores and metadata for active drivers', async () => {
    repository = new GeolocationRepository(
      configService as unknown as ConfigService,
    );
    georadiusMock.mockResolvedValueOnce([
      ['driver-1', '25', ['10', '20']],
      ['driver-2', '30', ['11', '21']],
    ]);
    zmscoreMock.mockResolvedValueOnce([1_000_100, 1_000_100]);
    hmgetMock.mockResolvedValueOnce([
      JSON.stringify({ accuracyMeters: 1, updatedAt: 'now' }),
      JSON.stringify({ accuracyMeters: 2, updatedAt: 'later' }),
    ]);

    const results = await repository.getNearbyDrivers(0, 0, 100, 2);

    expect(zmscoreMock).toHaveBeenCalledWith(
      ACTIVE_DRIVER_LOC_ZSET,
      'driver-1',
      'driver-2',
    );
    expect(hmgetMock).toHaveBeenCalledWith(
      DRIVER_METADATA_HASH_KEY,
      'driver-1',
      'driver-2',
    );
    expect(results).toEqual([
      {
        driverId: 'driver-1',
        distanceMeters: 25,
        location: { longitude: 10, latitude: 20 },
        metadata: { accuracyMeters: 1, updatedAt: 'now' },
      },
      {
        driverId: 'driver-2',
        distanceMeters: 30,
        location: { longitude: 11, latitude: 21 },
        metadata: { accuracyMeters: 2, updatedAt: 'later' },
      },
    ]);
  });

  it('returns distance as zero when raw distance is invalid', async () => {
    repository = new GeolocationRepository(
      configService as unknown as ConfigService,
    );
    georadiusMock.mockResolvedValueOnce([
      ['driver-1', 'NaN', ['10', '20']],
    ]);
    zmscoreMock.mockResolvedValueOnce([1_000_100]);
    hmgetMock.mockResolvedValueOnce([
      JSON.stringify({ accuracyMeters: 1, updatedAt: 'now' }),
    ]);

    const results = await repository.getNearbyDrivers(0, 0, 100, 1);

    expect(results).toEqual([
      {
        driverId: 'driver-1',
        distanceMeters: 0,
        location: { longitude: 10, latitude: 20 },
        metadata: { accuracyMeters: 1, updatedAt: 'now' },
      },
    ]);
  });

  it('ignores entries with non-array coordinates even when driver is active', async () => {
    repository = new GeolocationRepository(
      configService as unknown as ConfigService,
    );
    georadiusMock.mockResolvedValueOnce([
      ['driver-good', '10', ['1', '2']],
      ['driver-weird', '20', 'not-array'],
    ]);
    zmscoreMock.mockResolvedValueOnce([1_000_100, 1_000_100]);
    hmgetMock.mockResolvedValueOnce([
      JSON.stringify({ accuracyMeters: 1, updatedAt: 'now' }),
      JSON.stringify({ accuracyMeters: 2, updatedAt: 'later' }),
    ]);

    const results = await repository.getNearbyDrivers(0, 0, 100, 2);

    expect(results).toEqual([
      {
        driverId: 'driver-good',
        distanceMeters: 10,
        location: { longitude: 1, latitude: 2 },
        metadata: { accuracyMeters: 1, updatedAt: 'now' },
      },
    ]);
  });

  it('ignores drivers whose scores are below the active cutoff', async () => {
    repository = new GeolocationRepository(
      configService as unknown as ConfigService,
    );
    georadiusMock.mockResolvedValueOnce([
      ['driver-1', '100', ['10', '20']],
    ]);
    zmscoreMock.mockResolvedValueOnce([600_000]);

    const results = await repository.getNearbyDrivers(0, 0, 100, 1);

    expect(results).toEqual([]);
  });

  it('skips missing metadata but still returns active drivers', async () => {
    repository = new GeolocationRepository(
      configService as unknown as ConfigService,
    );
    georadiusMock.mockResolvedValueOnce([
      ['driver-1', '50', ['10', '20']],
    ]);
    zmscoreMock.mockResolvedValueOnce([1_000_100]);
    hmgetMock.mockResolvedValueOnce([null]);

    const results = await repository.getNearbyDrivers(0, 0, 100, 1);

    expect(results).toEqual([
      {
        driverId: 'driver-1',
        distanceMeters: 50,
        location: { longitude: 10, latitude: 20 },
        metadata: undefined,
      },
    ]);
  });

  it('filters out entries for inactive drivers and invalid coordinates', async () => {
    repository = new GeolocationRepository(
      configService as unknown as ConfigService,
    );
    georadiusMock.mockResolvedValueOnce([
      ['driver-active', '10', ['1', '2']],
      ['driver-inactive', '20', ['3', '4']],
      ['driver-bad-coords', '30', ['bad', 'coords']],
    ]);
    zmscoreMock.mockResolvedValueOnce([
      1_000_100,
      null,
      1_000_100,
    ]);
    hmgetMock.mockResolvedValueOnce([
      JSON.stringify({ accuracyMeters: 1, updatedAt: 'now' }),
      null,
      JSON.stringify({ accuracyMeters: 2, updatedAt: 'later' }),
    ]);

    const results = await repository.getNearbyDrivers(0, 0, 100, 3);

    expect(results).toEqual([
      {
        driverId: 'driver-active',
        distanceMeters: 10,
        location: { longitude: 1, latitude: 2 },
        metadata: { accuracyMeters: 1, updatedAt: 'now' },
      },
    ]);
  });

  it('skips metadata lookup when no drivers remain active after filtering', async () => {
    repository = new GeolocationRepository(
      configService as unknown as ConfigService,
    );
    georadiusMock.mockResolvedValueOnce([
      ['driver-1', '10', ['1', '2']],
      ['driver-2', '20', ['3', '4']],
    ]);
    zmscoreMock.mockResolvedValueOnce([null, undefined]);

    const results = await repository.getNearbyDrivers(0, 0, 100, 2);

    expect(zmscoreMock).toHaveBeenCalledWith(
      ACTIVE_DRIVER_LOC_ZSET,
      'driver-1',
      'driver-2',
    );
    expect(hmgetMock).not.toHaveBeenCalled();
    expect(results).toEqual([]);
  });
});
