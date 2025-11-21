import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { GeolocationRepository } from '../services/geolocation.repository';
import {
  LOCATION_QUEUE_NAME,
  LocationQueueJob,
  LocationUpdateJobData,
} from '../services/location.types';

@Processor(LOCATION_QUEUE_NAME, { concurrency: 5 })
export class LocationProcessor extends WorkerHost {
  private readonly logger = new Logger(LocationProcessor.name);

  constructor(private readonly geolocationRepository: GeolocationRepository) {
    super();
  }

  async process(job: Job<LocationUpdateJobData>): Promise<void> {
    switch (job.name) {
      case LocationQueueJob.UpsertDriverLocation:
        await this.handleUpsertLocation(job);
        break;
      default:
        this.logger.log(`Received unknown job: ${job.name}`);
    }
  }

  private async handleUpsertLocation(
    job: Job<LocationUpdateJobData>,
  ): Promise<void> {
    const { driverId, location, eventTimestamp } = job.data;
    await this.geolocationRepository.storeDriverLocation(
      driverId,
      location,
      eventTimestamp,
    );
    this.logger.log(`Processed location update job for driver ${driverId}`);
  }
}
