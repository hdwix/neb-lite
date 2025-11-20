import { LocationService } from './location.service';
import { Queue } from 'bullmq';
import {
  LOCATION_QUEUE_NAME,
  LocationQueueJob,
  LocationUpdateJobData,
} from './location.types';
import { GeolocationRepository } from './geolocation.repository';
import { ConfigService } from '@nestjs/config';

describe('LocationService', () => {
  let service: LocationService;
  let queue: jest.Mocked<Queue<LocationUpdateJobData>>;
  let repository: jest.Mocked<GeolocationRepository>;
  let configService: { get: jest.Mock };

  beforeEach(async () => {
    queue = {
      name: LOCATION_QUEUE_NAME,
      add: jest.fn(),
      getJob: jest.fn(),
    } as unknown as jest.Mocked<Queue<LocationUpdateJobData>>;

    repository = {
      storeDriverLocation: jest.fn(),
      getNearbyDrivers: jest.fn(),
    } as unknown as jest.Mocked<GeolocationRepository>;

    configService = { get: jest.fn() };

    service = new LocationService(queue, repository, configService as any);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('queues driver location updates', async () => {
    const result = await service.upsertDriverLocation('driver-1', {
      longitude: 106.8272,
      latitude: -6.1754,
      accuracyMeters: 12,
    });

    expect(result.longitude).toBe(106.8272);
    expect(result.latitude).toBe(-6.1754);
    expect(result.accuracyMeters).toBe(12);
    expect(result.updatedAt).toEqual(expect.any(String));
    expect(queue.add).toHaveBeenCalledWith(
      LocationQueueJob.UpsertDriverLocation,
      {
        driverId: 'driver-1',
        location: {
          longitude: 106.8272,
          latitude: -6.1754,
          accuracyMeters: 12,
        },
        eventTimestamp: result.updatedAt,
      },
      {
        jobId: 'driver-driver-1',
        removeOnComplete: true,
        removeOnFail: { count: 200 },
      },
    );
  });

  it('returns nearby drivers ordered by distance and limited', async () => {
    repository.getNearbyDrivers.mockResolvedValueOnce([
      {
        driverId: 'driver-1',
        distanceMeters: 50,
        location: { longitude: 106.8272, latitude: -6.1754 },
        metadata: { accuracyMeters: 5, updatedAt: 'now' },
      },
      {
        driverId: 'driver-2',
        distanceMeters: 150,
        location: { longitude: 106.8, latitude: -6.2 },
        metadata: { accuracyMeters: 8, updatedAt: 'later' },
      },
    ]);

    const results = await service.getNearbyDrivers(106.8272, -6.1754, 2);

    expect(results).toHaveLength(2);
    expect(results[0].driverId).toBe('driver-1');
    expect(results[0].distanceMeters).toBe(50);
    expect(results[0].accuracyMeters).toBe(5);
    expect(results[1].driverId).toBe('driver-2');
    expect(results[1].distanceMeters).toBe(150);
    expect(results[1].accuracyMeters).toBe(8);
    expect(repository.getNearbyDrivers).toHaveBeenCalledWith(
      106.8272,
      -6.1754,
      3000,
      2,
    );
    expect(configService.get).toHaveBeenCalled();
  });

  it('uses configured search radius when provided', async () => {
    const customQueue = {
      name: LOCATION_QUEUE_NAME,
      add: jest.fn(),
      getJob: jest.fn(),
    } as unknown as jest.Mocked<Queue<LocationUpdateJobData>>;

    const customRepository = {
      storeDriverLocation: jest.fn(),
      getNearbyDrivers: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<GeolocationRepository>;

    const customConfig = {
      get: jest.fn((key: string) =>
        key === 'SEARCH_RADIUS_METERS' ? '4500' : undefined,
      ),
    } as any;

    const customService = new LocationService(
      customQueue,
      customRepository,
      customConfig,
    );

    await customService.getNearbyDrivers(1, 1);

    expect(customRepository.getNearbyDrivers).toHaveBeenCalledWith(
      1,
      1,
      4500,
      10,
    );
  });
});
