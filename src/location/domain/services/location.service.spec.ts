import { Test, TestingModule } from '@nestjs/testing';
import { LocationService } from './location.service';
import { getQueueToken } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  LOCATION_QUEUE_NAME,
  LocationQueueJob,
  LocationUpdateJobData,
} from './location.types';
import { GeolocationRepository } from './geolocation.repository';

describe('LocationService', () => {
  let service: LocationService;
  let queue: jest.Mocked<Queue<LocationUpdateJobData>>;
  let repository: jest.Mocked<GeolocationRepository>;

  beforeEach(async () => {
    queue = {
      name: LOCATION_QUEUE_NAME,
      add: jest.fn(),
    } as unknown as jest.Mocked<Queue<LocationUpdateJobData>>;

    repository = {
      storeDriverLocation: jest.fn(),
      getNearbyDrivers: jest.fn(),
    } as unknown as jest.Mocked<GeolocationRepository>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LocationService,
        {
          provide: getQueueToken(LOCATION_QUEUE_NAME),
          useValue: queue,
        },
        {
          provide: GeolocationRepository,
          useValue: repository,
        },
      ],
    }).compile();

    service = module.get<LocationService>(LocationService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('queues driver location updates', async () => {
    queue.add.mockResolvedValueOnce({
      id: 'job-1',
      name: LocationQueueJob.UpsertDriverLocation,
      data: { driverId: 'driver-1', location: { lon: 0, lat: 0 } },
      timestamp: Date.now(),
      attemptsMade: 0,
    });

    const result = await service.upsertDriverLocation('driver-1', {
      lon: 106.8272,
      lat: -6.1754,
      accuracyMeters: 12,
    });

    expect(result.lon).toBe(106.8272);
    expect(result.lat).toBe(-6.1754);
    expect(result.accuracyMeters).toBe(12);
    expect(result.updatedAt).toEqual(expect.any(String));
    expect(queue.add).toHaveBeenCalledWith(
      LocationQueueJob.UpsertDriverLocation,
      {
        driverId: 'driver-1',
        location: {
          lon: 106.8272,
          lat: -6.1754,
          accuracyMeters: 12,
        },
        eventTimestamp: result.updatedAt,
      },
    );
  });

  it('returns nearby drivers ordered by distance and limited', async () => {
    repository.getNearbyDrivers.mockResolvedValueOnce([
      {
        driverId: 'driver-1',
        distanceMeters: 50,
        location: { lon: 106.8272, lat: -6.1754 },
        metadata: { accuracyMeters: 5, updatedAt: 'now' },
      },
      {
        driverId: 'driver-2',
        distanceMeters: 150,
        location: { lon: 106.8, lat: -6.2 },
        metadata: { accuracyMeters: 8, updatedAt: 'later' },
      },
    ]);

    const results = await service.getNearbyDrivers(106.8272, -6.1754, 20000, 2);

    expect(results).toHaveLength(2);
    expect(results[0].driverId).toBe('driver-1');
    expect(results[0].distanceMeters).toBe(50);
    expect(results[0].accuracyMeters).toBe(5);
    expect(results[0].etaSeconds).toBe(Math.round(50 / 6));
    expect(results[1].driverId).toBe('driver-2');
    expect(results[1].distanceMeters).toBe(150);
    expect(results[1].accuracyMeters).toBe(8);
    expect(repository.getNearbyDrivers).toHaveBeenCalledWith(
      106.8272,
      -6.1754,
      20000,
      2,
    );
  });
});
