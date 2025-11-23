import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { GeolocationRepository } from '../services/geolocation.repository';
import { LocationProcessor } from './location.processor';
import {
  LocationQueueJob,
  LocationUpdateJobData,
} from '../services/location.types';

describe('LocationProcessor', () => {
  const storeDriverLocation = jest.fn();
  const geolocationRepository = {
    storeDriverLocation,
  } as unknown as GeolocationRepository;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('processes location update jobs', async () => {
    const processor = new LocationProcessor(geolocationRepository);
    const job = {
      name: LocationQueueJob.UpsertDriverLocation,
      data: {
        driverId: 'driver-1',
        location: { longitude: 1, latitude: 2, accuracyMeters: 3 },
        eventTimestamp: '2024-01-01T00:00:00.000Z',
      },
    } as Job<LocationUpdateJobData>;

    await processor.process(job);

    expect(storeDriverLocation).toHaveBeenCalledWith(
      'driver-1',
      { longitude: 1, latitude: 2, accuracyMeters: 3 },
      '2024-01-01T00:00:00.000Z',
    );
  });

  it('logs unknown jobs', async () => {
    const warnSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    const processor = new LocationProcessor(geolocationRepository);
    const job = { name: 'unknown' } as Job<LocationUpdateJobData>;

    await processor.process(job);

    expect(warnSpy).toHaveBeenCalledWith('Received unknown job: unknown');
  });
});
