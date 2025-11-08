import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import {
  RIDE_QUEUE_NAME,
  RideQueueJob,
  RideQueueJobData,
  RideRouteEstimationJobData,
} from '../types/ride-queue.types';
import { RidesService, RouteEstimates } from '../services/rides.service';

@Processor(RIDE_QUEUE_NAME, { concurrency: 2 })
export class RideProcessor extends WorkerHost {
  private readonly logger = new Logger(RideProcessor.name);

  constructor(private readonly ridesService: RidesService) {
    super();
  }

  async process(job: Job<RideQueueJobData>): Promise<unknown> {
    switch (job.name) {
      case RideQueueJob.EstimateRoute:
        return this.handleRouteEstimation(job.data as RideRouteEstimationJobData);
      default:
        this.logger.warn(`Received unknown ride job ${job.name}`);
    }
  }

  private async handleRouteEstimation(
    data: RideRouteEstimationJobData,
  ): Promise<RouteEstimates> {
    this.logger.debug(`Estimating route for ride ${data.rideId}`);

    return this.ridesService.fetchRouteEstimates(data.pickup, data.dropoff);
  }
}
