import { Logger } from '@nestjs/common';
import { Queue, Job } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import { LocationService } from './location.service';
import { GeolocationRepository } from './geolocation.repository';
import {
  LOCATION_QUEUE_NAME,
  LocationQueueJob,
  LocationUpdateJobData,
} from './location.types';

describe('LocationService', () => {
  let service: LocationService;
  let queue: jest.Mocked<Queue<LocationUpdateJobData>>;
  let repository: jest.Mocked<GeolocationRepository>;
  let configService: { get: jest.Mock };

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2024-01-01T00:00:00Z'));

    queue = {
      name: LOCATION_QUEUE_NAME,
      add: jest.fn().mockResolvedValue({} as Job<LocationUpdateJobData>),
      getJob: jest.fn(),
    } as unknown as jest.Mocked<Queue<LocationUpdateJobData>>;

    repository = {
      getNearbyDrivers: jest.fn(),
    } as unknown as jest.Mocked<GeolocationRepository>;

    configService = {
      get: jest.fn((key: string) =>
        key === 'SEARCH_RADIUS_METERS' ? '4500' : undefined,
      ),
    } as any;

    service = new LocationService(queue, repository, configService as any);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('queues driver location updates with configured radius', async () => {
    const entry = await service.upsertDriverLocation('driver-1', {
      longitude: 10,
      latitude: 20,
      accuracyMeters: 7,
    });

    expect(entry).toEqual({
      longitude: 10,
      latitude: 20,
      accuracyMeters: 7,
      updatedAt: '2024-01-01T00:00:00.000Z',
    });
    expect(queue.add).toHaveBeenCalledWith(
      LocationQueueJob.UpsertDriverLocation,
      {
        driverId: 'driver-1',
        location: { longitude: 10, latitude: 20, accuracyMeters: 7 },
        eventTimestamp: '2024-01-01T00:00:00.000Z',
      },
      {
        jobId: 'driver-driver-1',
        removeOnComplete: true,
        removeOnFail: { count: 200 },
      },
    );
  });

  it('returns existing in-flight job result when job already exists', async () => {
    const debugSpy = jest.spyOn(Logger.prototype, 'debug').mockImplementation();
    const existingJob = {
      getState: jest.fn().mockResolvedValue('active'),
    } as any;
    queue.add.mockRejectedValueOnce({
      name: 'JobIdAlreadyExistsError',
      message: 'JobIdAlreadyExists',
    });
    queue.getJob.mockResolvedValueOnce(existingJob);

    const entry = await service.upsertDriverLocation('driver-2', {
      longitude: 11,
      latitude: 21,
    });

    expect(queue.getJob).toHaveBeenCalledWith('driver-driver-2');
    expect(existingJob.getState).toHaveBeenCalled();
    expect(entry.updatedAt).toBe('2024-01-01T00:00:00.000Z');
    expect(debugSpy).toHaveBeenCalledWith(
      'Driver driver-2 already has an active location update job; keeping the in-flight job and skipping requeue.',
    );
  });

  it('rethrows when duplicate job is not active', async () => {
    queue.add.mockRejectedValueOnce({
      name: 'JobIdAlreadyExistsError',
      message: 'JobIdAlreadyExists',
    });
    queue.getJob.mockResolvedValueOnce({
      getState: jest.fn().mockResolvedValue('waiting'),
    } as any);

    await expect(
      service.upsertDriverLocation('driver-3', { longitude: 1, latitude: 2 }),
    ).rejects.toMatchObject({ message: 'JobIdAlreadyExists' });
  });

  it('rethrows non-job-id errors when queueing', async () => {
    queue.add.mockRejectedValueOnce(new Error('network down'));

    await expect(
      service.upsertDriverLocation('driver-4', { longitude: 0, latitude: 0 }),
    ).rejects.toThrow('network down');
    expect(queue.getJob).not.toHaveBeenCalled();
  });

  it('maps nearby drivers with default limit and radius fallback', async () => {
    configService.get = jest.fn(() => undefined);
    service = new LocationService(queue, repository, configService as any);
    repository.getNearbyDrivers.mockResolvedValueOnce([
      {
        driverId: 'd1',
        distanceMeters: 10,
        location: { longitude: 1, latitude: 2 },
        metadata: { accuracyMeters: 3, updatedAt: 'now' },
      },
    ]);

    const results = await service.getNearbyDrivers(5, 6);

    expect(repository.getNearbyDrivers).toHaveBeenCalledWith(5, 6, 3000, 10);
    expect(results).toEqual([
      {
        driverId: 'd1',
        distanceMeters: 10,
        accuracyMeters: 3,
        updatedAt: 'now',
      },
    ]);
  });
});
