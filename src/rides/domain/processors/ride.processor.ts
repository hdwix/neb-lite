import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import {
  RIDE_QUEUE_NAME,
  RideQueueJob,
  RideQueueJobData,
  RideRouteEstimationJobData,
  RideSelectionJobData,
} from '../types/ride-queue.types';
import { RidesService, RouteEstimates } from '../services/rides.service';
import { ERideStatus } from '../../../app/enums/ride-status.enum';

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
      case RideQueueJob.ProcessSelection:
        await this.handleRideWorkflow(job.data as RideSelectionJobData);
        return;
      default:
        this.logger.warn(`Received unknown ride job ${job.name}`);
    }
  }

  private async handleRideWorkflow(
    data: RideSelectionJobData,
  ): Promise<void> {
    const { rideId } = data;

    this.logger.debug(`Processing workflow for ride ${rideId}`);

    await this.ridesService.transitionRideStatus(
      rideId,
      [ERideStatus.REQUESTED, ERideStatus.CANDIDATES_COMPUTED],
      ERideStatus.ASSIGNED,
      'Driver selected by rider',
    );

    await this.ridesService.transitionRideStatus(
      rideId,
      [ERideStatus.ASSIGNED],
      ERideStatus.ACCEPTED,
      'Driver accepted ride request',
    );

    await this.ridesService.transitionRideStatus(
      rideId,
      [ERideStatus.ACCEPTED],
      ERideStatus.ENROUTE,
      'Driver enroute to rider pickup',
    );

    this.logger.debug(`Completed workflow for ride ${rideId}`);
  }

  private async handleRouteEstimation(
    data: RideRouteEstimationJobData,
  ): Promise<RouteEstimates> {
    this.logger.debug(`Estimating route for ride ${data.rideId}`);

    return this.ridesService.fetchRouteEstimates(data.pickup, data.dropoff);
  }
}
