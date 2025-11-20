/* istanbul ignore file */
import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import {
  TRIP_TRACKING_QUEUE_NAME,
  TripTrackingQueueJob,
  TripTrackingJobData,
} from '../constants/trip-tracking.constants';
import { TripTrackingService } from '../services/trip-tracking.service';

@Processor(TRIP_TRACKING_QUEUE_NAME, { concurrency: 1 })
export class TripTrackingProcessor extends WorkerHost {
  private readonly logger = new Logger(TripTrackingProcessor.name);

  constructor(private readonly tripTrackingService: TripTrackingService) {
    super();
  }

  async process(job: Job<TripTrackingJobData>): Promise<void> {
    switch (job.name) {
      case TripTrackingQueueJob.FlushAll:
        await this.handleFlushAll(job);
        break;
      case TripTrackingQueueJob.FlushRide:
        await this.handleFlushRide(job);
        break;
      default:
        this.logger.warn(`Received unknown trip tracking job: ${job.name}`);
    }
  }

  private async handleFlushAll(job: Job<TripTrackingJobData>): Promise<void> {
    this.logger.debug(`Processing trip tracking flush-all job ${job.id}`);
    await this.tripTrackingService.flushAll();
  }

  private async handleFlushRide(job: Job<TripTrackingJobData>): Promise<void> {
    const rideId = (job.data as { rideId?: string })?.rideId;

    if (!rideId) {
      this.logger.warn('Received flush-ride job without rideId');
      return;
    }

    this.logger.debug(`Processing trip tracking flush-ride job ${job.id} for ${rideId}`);
    await this.tripTrackingService.flushRide(rideId);
  }
}
