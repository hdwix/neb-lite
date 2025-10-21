import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { GeolocationRepository } from './geolocation.repository';
import {
  DriverLocationEntry,
  DriverLocationInput,
  LOCATION_QUEUE_NAME,
  LocationQueueJob,
  LocationUpdateJobData,
  NearbyDriver,
} from './location.types';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class LocationService {
  private readonly logger = new Logger(LocationService.name);
  private readonly searchRadiusMeters: number;

  constructor(
    @InjectQueue(LOCATION_QUEUE_NAME)
    private readonly locationQueue: Queue<LocationUpdateJobData>,
    private readonly geolocationRepository: GeolocationRepository,
    private readonly configService: ConfigService,
  ) {
    this.searchRadiusMeters = this.resolveSearchRadius();
  }

  async upsertDriverLocation(
    driverId: string,
    location: DriverLocationInput,
  ): Promise<DriverLocationEntry> {
    const eventTimestamp = new Date().toISOString();
    const entry: DriverLocationEntry = {
      longitude: location.longitude,
      latitude: location.latitude,
      accuracyMeters: location.accuracyMeters,
      updatedAt: eventTimestamp,
    };
    const jobId = `driver-${driverId}`;

    try {
      await this.locationQueue.add(
        LocationQueueJob.UpsertDriverLocation,
        {
          driverId,
          location,
          eventTimestamp,
        },
        {
          jobId,
          removeOnComplete: true, // set to true to immediate update drivers loc to redis
          removeOnFail: { count: 200 },
        },
      );
    } catch (error) {
      if (this.isJobIdAlreadyExistsError(error)) {
        const existingJob = await this.locationQueue.getJob(jobId);
        const existingJobState = await existingJob?.getState();

        if (existingJobState === 'active') {
          this.logger.debug(
            `Driver ${driverId} already has an active location update job; keeping the in-flight job and skipping requeue.`,
          );
          return entry;
        }
      }

      throw error;
    }
    this.logger.log(`Queued location update for driver ${driverId}`);
    return entry;
  }

  async getNearbyDrivers(
    longitude: number,
    latitude: number,
    limit = 10,
  ): Promise<NearbyDriver[]> {
    const results = await this.geolocationRepository.getNearbyDrivers(
      longitude,
      latitude,
      this.searchRadiusMeters,
      limit,
    );

    return results.map((result) => ({
      driverId: result.driverId,
      distanceMeters: result.distanceMeters,
      accuracyMeters: result.metadata?.accuracyMeters,
      updatedAt: result.metadata?.updatedAt,
    }));
  }

  private isJobIdAlreadyExistsError(error: unknown): boolean {
    if (!error || typeof error !== 'object') {
      return false;
    }

    const message = 'message' in error ? String(error.message) : '';
    const name = 'name' in error ? String(error.name) : '';

    return (
      name === 'JobIdAlreadyExistsError' ||
      message.includes('JobIdAlreadyExists')
    );
  }

  private resolveSearchRadius(): number {
    const candidateValues: Array<string | number | undefined> = [
      this.configService.get<number>('SEARCH_RADIUS_METERS'),
      this.configService.get<number>('SEARCH_RADIUS'),
      this.configService.get<number>('searchRadius'),
      this.configService.get<number>('DEFAULT_SEARCH_RANGE'),
    ];

    for (const value of candidateValues) {
      const parsed =
        typeof value === 'string' ? Number.parseFloat(value) : value;

      if (
        typeof parsed === 'number' &&
        Number.isFinite(parsed) &&
        parsed > 0
      ) {
        return parsed;
      }
    }

    return 3000;
  }
}
