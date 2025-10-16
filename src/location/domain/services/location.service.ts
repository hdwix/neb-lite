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

@Injectable()
export class LocationService {
  private readonly logger = new Logger(LocationService.name);
  private readonly averageDriverSpeedMetersPerSecond = 6;

  constructor(
    @InjectQueue(LOCATION_QUEUE_NAME)
    private readonly locationQueue: Queue<LocationUpdateJobData>,
    private readonly geolocationRepository: GeolocationRepository,
  ) {}

  async upsertDriverLocation(
    driverId: string,
    location: DriverLocationInput,
  ): Promise<DriverLocationEntry> {
    const eventTimestamp = new Date().toISOString();
    const entry: DriverLocationEntry = {
      lon: location.lon,
      lat: location.lat,
      accuracyMeters: location.accuracyMeters,
      updatedAt: eventTimestamp,
    };

    try {
      // Ensure we do not accumulate redundant waiting jobs for the same driver
      await this.locationQueue.removeJobs(driverId);
    } catch (error) {
      this.logger.warn(
        `Failed to prune existing queue jobs for driver ${driverId}: ${error}`,
      );
    }

    try {
      await this.locationQueue.add(
        LocationQueueJob.UpsertDriverLocation,
        {
          driverId,
          location,
          eventTimestamp,
        },
        {
          jobId: driverId,
          removeOnComplete: true,
          removeOnFail: 25,
        },
      );
    } catch (error) {
      if (this.isJobIdAlreadyExistsError(error)) {
        const existingJob = await this.locationQueue.getJob(driverId);
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
    lon: number,
    lat: number,
    radiusMeters = 3000,
    limit = 10,
  ): Promise<NearbyDriver[]> {
    const results = await this.geolocationRepository.getNearbyDrivers(
      lon,
      lat,
      radiusMeters,
      limit,
    );

    return results.map((result) => ({
      driverId: result.driverId,
      distanceMeters: result.distanceMeters,
      etaSeconds: this.calculateEtaSeconds(result.distanceMeters),
      accuracyMeters: result.metadata?.accuracyMeters,
      updatedAt: result.metadata?.updatedAt,
    }));
  }

  private calculateEtaSeconds(distanceMeters: number): number | undefined {
    if (this.averageDriverSpeedMetersPerSecond <= 0) {
      return undefined;
    }
    return Math.round(distanceMeters / this.averageDriverSpeedMetersPerSecond);
  }

  private isJobIdAlreadyExistsError(error: unknown): boolean {
    if (!error || typeof error !== 'object') {
      return false;
    }

    const message = 'message' in error ? String(error.message) : '';
    const name = 'name' in error ? String(error.name) : '';

    return (
      name === 'JobIdAlreadyExistsError' || message.includes('JobIdAlreadyExists')
    );
  }
}
