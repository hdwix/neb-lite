import { Logger } from '@nestjs/common';
import { Process, Processor } from '@nestjs/bull';
import { GeolocationRepository } from '../services/geolocation.repository';
import {
  LOCATION_QUEUE_NAME,
  LocationQueueJob,
  LocationUpdateJobData,
} from '../services/location.types';
import { Job } from '@nestjs/bull';

@Processor(LOCATION_QUEUE_NAME)
export class LocationProcessor {
  private readonly logger = new Logger(LocationProcessor.name);

  constructor(private readonly geolocationRepository: GeolocationRepository) {}

  @Process({ name: LocationQueueJob.UpsertDriverLocation, concurrency: 5 })
  async handleUpsertLocation(job: Job<LocationUpdateJobData>): Promise<void> {
    const { driverId, location } = job.data;
    await this.geolocationRepository.storeDriverLocation(driverId, location);
    this.logger.debug(`Processed location update job for driver ${driverId}`);
  }
}
