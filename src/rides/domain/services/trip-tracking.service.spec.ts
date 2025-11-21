import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import Redis from 'ioredis';
import { Queue } from 'bullmq';
import { TripTrackingService } from './trip-tracking.service';
import {
  TRIP_TRACKING_QUEUE_NAME,
  TripTrackingQueueJob,
} from '../constants/trip-tracking.constants';
import { EClientType } from '../../../app/enums/client-type.enum';

jest.mock('@nestjs/bullmq', () => ({
  InjectQueue: () => () => undefined,
}));

jest.mock('ioredis', () => ({
  __esModule: true,
  default: jest.fn(),
}));

type MockRedis = jest.Mocked<Redis> & { __pipeline?: any };

describe('TripTrackingService', () => {
  let redis: MockRedis;
  let pipeline: any;
  let tripTrackingQueue: jest.Mocked<Queue>;
  let service: TripTrackingService;
  let configService: { get: jest.Mock };
  let tripTrackRepository: any;

  beforeEach(() => {
    pipeline = {
      geoadd: jest.fn().mockReturnThis(),
      geodist: jest.fn().mockReturnThis(),
      del: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([
        [null, 'OK'],
        [null, 'OK'],
        [null, 42],
        [null, 1],
      ]),
    };

    const RedisMock = Redis as unknown as jest.Mock;
    RedisMock.mockImplementation(() => {
      redis = {
        get: jest.fn().mockResolvedValue(null),
        set: jest.fn().mockResolvedValue('OK'),
        sadd: jest.fn().mockResolvedValue(1),
        rpush: jest.fn().mockResolvedValue(1),
        expire: jest.fn().mockResolvedValue(1),
        smembers: jest.fn().mockResolvedValue([]),
        lrange: jest.fn().mockResolvedValue([]),
        del: jest.fn().mockResolvedValue(1),
        srem: jest.fn().mockResolvedValue(1),
        llen: jest.fn().mockResolvedValue(0),
        pipeline: jest.fn().mockReturnValue(pipeline),
      } as unknown as MockRedis;
      return redis;
    });

    configService = {
      get: jest.fn((key: string) => {
        if (key === 'TRIP_TRACKING_FLUSH_INTERVAL_MS') return 1000;
        return undefined;
      }),
    } as unknown as ConfigService as any;

    tripTrackRepository = {
      create: jest.fn((v) => v),
      persistFlush: jest.fn().mockResolvedValue(undefined),
    };

    tripTrackingQueue = {
      getJobSchedulers: jest.fn().mockResolvedValue([]),
      removeJobScheduler: jest.fn(),
      add: jest.fn(),
    } as any;

    service = new TripTrackingService(
      new (Redis as any)(),
      configService as any,
      tripTrackRepository,
      tripTrackingQueue as any,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it('schedules flush job on module init', async () => {
    const spy = jest
      .spyOn<any, any>(service as any, 'ensureFlushScheduler')
      .mockResolvedValue(undefined);
    await service.onModuleInit();
    expect(spy).toHaveBeenCalled();
  });

  it('flushes all on destroy and logs errors', async () => {
    const flushSpy = jest
      .spyOn(service, 'flushAll')
      .mockRejectedValue(new Error('fail'));
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();

    await service.onModuleDestroy();

    expect(flushSpy).toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
  });

  it('records driver location with distance calculation', async () => {
    jest.spyOn(service as any, 'getState').mockResolvedValue({
      rideId: 'ride-1',
      totalDistanceMeters: 5,
      lastDriverLocation: { longitude: 1, latitude: 1, recordedAt: 'old' },
    });
    jest
      .spyOn(service, 'calculateDistanceBetweenCoordinates')
      .mockResolvedValue(10);

    const result = await service.recordLocation(
      'ride-1',
      'driver-1',
      EClientType.DRIVER,
      { longitude: 2, latitude: 2, recordedAt: 'now' },
    );

    expect(result).toEqual({
      totalDistanceMeters: 15,
      distanceDeltaMeters: 10,
    });
    expect(redis.set).toHaveBeenCalled();
    expect(redis.rpush).toHaveBeenCalled();
    expect(redis.sadd).toHaveBeenCalledWith('trip:active', 'ride-1');
  });

  it('records rider location without distance delta', async () => {
    const result = await service.recordLocation(
      'ride-2',
      'rider-1',
      EClientType.RIDER,
      { longitude: 3, latitude: 4, recordedAt: 'now' },
    );

    expect(result).toEqual({ totalDistanceMeters: 0, distanceDeltaMeters: 0 });
    expect(redis.set).toHaveBeenCalled();
    expect(redis.rpush).toHaveBeenCalled();
  });

  it('gets latest locations and totals from state', async () => {
    jest.spyOn(service as any, 'getState').mockResolvedValue({
      rideId: 'ride-1',
      totalDistanceMeters: 7,
      lastDriverLocation: { longitude: 1, latitude: 1, recordedAt: 'a' },
      lastRiderLocation: { longitude: 2, latitude: 2, recordedAt: 'b' },
    });

    await expect(
      service.getLatestLocation('ride-1', EClientType.DRIVER),
    ).resolves.toEqual(expect.objectContaining({ longitude: 1 }));
    await expect(
      service.getLatestLocation('ride-1', EClientType.RIDER),
    ).resolves.toEqual(expect.objectContaining({ longitude: 2 }));
    await expect(service.getTotalDistanceMeters('ride-1')).resolves.toBe(7);
  });

  it('marks ride completed and enqueues flush', async () => {
    jest.spyOn(service as any, 'getState').mockResolvedValue({
      rideId: 'ride-1',
      totalDistanceMeters: 1,
      completed: false,
    });
    const enqueueSpy = jest
      .spyOn<any, any>(service as any, 'enqueueFlushRideJob')
      .mockResolvedValue(undefined);

    await service.markRideCompleted('ride-1');

    expect(redis.set).toHaveBeenCalled();
    expect(enqueueSpy).toHaveBeenCalledWith('ride-1');
  });

  it('flushes all active rides and logs failures', async () => {
    redis.smembers.mockResolvedValue(['ride-a', 'ride-b']);
    const flushRideSpy = jest
      .spyOn(service, 'flushRide')
      .mockResolvedValueOnce(undefined as any)
      .mockRejectedValueOnce(new Error('boom'));
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();

    await service.flushAll();

    expect(flushRideSpy).toHaveBeenCalledTimes(2);
    expect(errorSpy).toHaveBeenCalled();
  });

  it('returns early when no active rides exist', async () => {
    redis.smembers.mockResolvedValue([]);
    const flushRideSpy = jest.spyOn(service, 'flushRide');

    await service.flushAll();

    expect(flushRideSpy).not.toHaveBeenCalled();
  });

  it('cleans up when flushing empty completed ride', async () => {
    redis.lrange.mockResolvedValue([]);
    jest.spyOn(service as any, 'getState').mockResolvedValue({
      rideId: 'ride-1',
      totalDistanceMeters: 0,
      completed: true,
    });

    await service.flushRide('ride-1');

    expect(redis.del).toHaveBeenCalledTimes(2);
    expect(redis.srem).toHaveBeenCalledWith('trip:active', 'ride-1');
  });

  it('flushes events, handles invalid payloads, and cleans completed ride', async () => {
    const goodEvent = JSON.stringify({
      role: EClientType.DRIVER,
      clientId: 'driver-1',
      longitude: 1,
      latitude: 1,
      recordedAt: 'now',
      distanceDeltaMeters: 5,
      totalDistanceMeters: 5,
    });
    redis.lrange.mockResolvedValue([goodEvent, 'invalid-json']);
    redis.llen.mockResolvedValue(0);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(service as any, 'getState').mockResolvedValue({
      rideId: 'ride-1',
      totalDistanceMeters: 5,
      completed: true,
    });

    await service.flushRide('ride-1');

    expect(redis.del).toHaveBeenCalledWith('trip:events:ride-1');
    expect(tripTrackRepository.persistFlush).toHaveBeenCalledWith(
      [expect.objectContaining({ rideId: 'ride-1' })],
      expect.any(Array),
    );
    expect(redis.srem).toHaveBeenCalledWith('trip:active', 'ride-1');
  });

  it('parses state safely and logs errors', async () => {
    redis.get.mockResolvedValueOnce('{bad json');
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();

    const state = await (service as any).getState('ride-1');

    expect(state).toEqual({ rideId: 'ride-1', totalDistanceMeters: 0 });
    expect(warnSpy).toHaveBeenCalled();
  });

  it('returns parsed state values', async () => {
    redis.get.mockResolvedValueOnce(
      JSON.stringify({
        totalDistanceMeters: 9,
        lastDriverLocation: { longitude: 1, latitude: 2, recordedAt: 't1' },
        lastRiderLocation: { longitude: 3, latitude: 4, recordedAt: 't2' },
        completed: true,
      }),
    );

    const state = await (service as any).getState('ride-abc');

    expect(state).toEqual({
      rideId: 'ride-abc',
      totalDistanceMeters: 9,
      lastDriverLocation: expect.objectContaining({ longitude: 1 }),
      lastRiderLocation: expect.objectContaining({ longitude: 3 }),
      completed: true,
    });
  });

  it('returns parsed state with defaults when values missing', async () => {
    redis.get.mockResolvedValueOnce(JSON.stringify({}));

    const state = await (service as any).getState('ride-missing');

    expect(state).toEqual({
      rideId: 'ride-missing',
      totalDistanceMeters: 0,
      lastDriverLocation: undefined,
      lastRiderLocation: undefined,
      completed: false,
    });
  });

  it('uses default flush interval when configured value is invalid', () => {
    configService.get.mockReturnValueOnce(-50 as any);

    const svc = new TripTrackingService(
      new (Redis as any)(),
      configService as any,
      tripTrackRepository,
      tripTrackingQueue as any,
    ) as any;

    expect(svc.flushIntervalMs).toBe(60_000);
  });

  it('uses flush interval value defined in env', () => {
    configService.get.mockReturnValueOnce(100 as any);

    const svc = new TripTrackingService(
      new (Redis as any)(),
      configService as any,
      tripTrackRepository,
      tripTrackingQueue as any,
    ) as any;

    expect(svc.flushIntervalMs).toBe(100);
  });

  it('returns null when no driver location exists', async () => {
    jest
      .spyOn(service as any, 'getState')
      .mockResolvedValue({ rideId: 'ride-1', totalDistanceMeters: 0 });

    await expect(
      service.getLatestLocation('ride-1', EClientType.DRIVER),
    ).resolves.toBeNull();
  });

  it('returns null when no rider location exists', async () => {
    jest
      .spyOn(service as any, 'getState')
      .mockResolvedValue({ rideId: 'ride-1', totalDistanceMeters: 0 });

    await expect(
      service.getLatestLocation('ride-1', EClientType.RIDER),
    ).resolves.toBeNull();
  });

  it('calculates distance via redis pipeline and handles failures', async () => {
    const result = await (service as any).calculateDistanceMeters(0, 0, 1, 1);
    expect(result).toBe(42);

    pipeline.exec.mockRejectedValueOnce(new Error('x'));
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();

    const fallback = await (service as any).calculateDistanceMeters(0, 0, 1, 1);

    expect(fallback).toBe(0);
    expect(errorSpy).toHaveBeenCalled();
  });

  it('returns zero when redis distance result is not finite', async () => {
    pipeline.exec.mockResolvedValueOnce([
      [null, 'OK'],
      [null, 'OK'],
      [null, 'not-a-number'],
      [null, 1],
    ] as any);

    await expect(
      (service as any).calculateDistanceMeters(0, 0, 1, 1),
    ).resolves.toBe(0);
  });

  it('returns zero distance when pipeline result missing', async () => {
    pipeline.exec.mockResolvedValueOnce([
      [null, 'OK'],
      [null, 'OK'],
    ] as any);

    await expect(
      (service as any).calculateDistanceMeters(0, 0, 1, 1),
    ).resolves.toBe(0);
  });

  it('delegates coordinate distance calculation', async () => {
    const spy = jest
      .spyOn<any, any>(service as any, 'calculateDistanceMeters')
      .mockResolvedValue(123);

    const distance = await service.calculateDistanceBetweenCoordinates(
      { longitude: 1, latitude: 2 },
      { longitude: 3, latitude: 4 },
    );

    expect(distance).toBe(123);
    expect(spy).toHaveBeenCalledWith(1, 2, 3, 4);
  });

  it('ensures scheduler is updated when interval changes', async () => {
    tripTrackingQueue.getJobSchedulers.mockResolvedValue([
      { name: TripTrackingQueueJob.FlushAll, every: 500, key: 'key-1' },
    ] as any);

    await (service as any).ensureFlushScheduler();

    expect(tripTrackingQueue.removeJobScheduler).toHaveBeenCalledWith('key-1');
    expect(tripTrackingQueue.add).toHaveBeenCalledWith(
      TripTrackingQueueJob.FlushAll,
      {},
      expect.objectContaining({ jobId: 'trip-tracking:flush-all' }),
    );
  });

  it('skips scheduler creation when matching interval exists', async () => {
    tripTrackingQueue.getJobSchedulers.mockResolvedValue([
      { name: TripTrackingQueueJob.FlushAll, every: 1000, key: 'key-1' },
    ] as any);

    await (service as any).ensureFlushScheduler();

    expect(tripTrackingQueue.removeJobScheduler).not.toHaveBeenCalled();
    expect(tripTrackingQueue.add).not.toHaveBeenCalled();
  });

  it('updates scheduler when existing job interval is null', async () => {
    tripTrackingQueue.getJobSchedulers.mockResolvedValue([
      { name: TripTrackingQueueJob.FlushAll, every: null, key: 'key-null' },
    ] as any);

    await (service as any).ensureFlushScheduler();

    expect(tripTrackingQueue.removeJobScheduler).toHaveBeenCalledWith(
      'key-null',
    );
    expect(tripTrackingQueue.add).toHaveBeenCalledWith(
      TripTrackingQueueJob.FlushAll,
      {},
      expect.objectContaining({ jobId: 'trip-tracking:flush-all' }),
    );
  });

  it('handles duplicate flush ride jobs gracefully', async () => {
    tripTrackingQueue.add.mockRejectedValueOnce(
      Object.assign(new Error('dup'), { name: 'JobIdAlreadyExistsError' }),
    );
    const debugSpy = jest.spyOn(Logger.prototype, 'debug').mockImplementation();

    await (service as any).enqueueFlushRideJob('ride-1');

    expect(debugSpy).toHaveBeenCalled();
  });

  it('rethrows unexpected enqueue errors', async () => {
    tripTrackingQueue.add.mockRejectedValueOnce(new Error('other'));

    await expect(
      (service as any).enqueueFlushRideJob('ride-1'),
    ).rejects.toThrow('other');
  });

  it('detects job id errors only for object inputs', () => {
    expect((service as any).isJobIdAlreadyExistsError(null)).toBe(false);
  });

  it('parses string distance results from redis', async () => {
    pipeline.exec.mockResolvedValueOnce([
      [null, 'OK'],
      [null, 'OK'],
      [null, '123.45'],
      [null, 1],
    ] as any);

    await expect(
      (service as any).calculateDistanceMeters(0, 0, 1, 1),
    ).resolves.toBeCloseTo(123.45);
  });

  it('skips scheduler creation when existing interval stored as string', async () => {
    configService.get.mockReturnValueOnce(2000 as any);
    const svc = new TripTrackingService(
      new (Redis as any)(),
      configService as any,
      tripTrackRepository,
      tripTrackingQueue as any,
    ) as any;

    tripTrackingQueue.getJobSchedulers.mockResolvedValue([
      { name: TripTrackingQueueJob.FlushAll, every: '2000', key: 'key-2' },
    ] as any);

    await svc.ensureFlushScheduler();

    expect(tripTrackingQueue.removeJobScheduler).not.toHaveBeenCalled();
    expect(tripTrackingQueue.add).not.toHaveBeenCalled();
  });

  it('persists summaries with null distance when value is not finite', async () => {
    const badEvent = JSON.stringify({
      role: EClientType.DRIVER,
      clientId: 'driver-1',
      longitude: 1,
      latitude: 1,
      recordedAt: 'now',
      distanceDeltaMeters: 0,
      totalDistanceMeters: 'NaN',
    });

    redis.lrange.mockResolvedValue([badEvent]);
    jest.spyOn(service as any, 'getState').mockResolvedValue({
      rideId: 'ride-1',
      totalDistanceMeters: 0,
    });

    await service.flushRide('ride-1');

    expect(tripTrackRepository.persistFlush).toHaveBeenCalledWith(
      expect.any(Array),
      expect.arrayContaining([
        expect.objectContaining({
          totalDistanceMeters: null,
          clientId: 'driver-1',
        }),
      ]),
    );
  });

  it('persists rider summaries with null distance', async () => {
    const riderEvent = JSON.stringify({
      role: EClientType.RIDER,
      clientId: 'rider-1',
      longitude: 1,
      latitude: 1,
      recordedAt: 'now',
      distanceDeltaMeters: 0,
      totalDistanceMeters: 10,
    });

    redis.lrange.mockResolvedValue([riderEvent]);
    jest.spyOn(service as any, 'getState').mockResolvedValue({
      rideId: 'ride-2',
      totalDistanceMeters: 0,
    });

    await service.flushRide('ride-2');

    expect(tripTrackRepository.persistFlush).toHaveBeenCalledWith(
      expect.any(Array),
      expect.arrayContaining([
        expect.objectContaining({
          clientRole: EClientType.RIDER,
          totalDistanceMeters: null,
        }),
      ]),
    );
  });

  it('uses default interval when config service returns undefined', () => {
    configService.get.mockReturnValueOnce(undefined as any);

    const svc = new TripTrackingService(
      new (Redis as any)(),
      configService as any,
      tripTrackRepository,
      tripTrackingQueue as any,
    ) as any;

    expect(svc.flushIntervalMs).toBe(60_000);
  });

  it('identifies duplicate job errors using name field', () => {
    const error = { name: 'JobIdAlreadyExistsError' };

    expect((service as any).isJobIdAlreadyExistsError(error)).toBe(true);
  });

  it('identifies duplicate job errors based on message', () => {
    const error = { message: 'JobIdAlreadyExists: ride-1' };

    expect((service as any).isJobIdAlreadyExistsError(error)).toBe(true);
  });
});
