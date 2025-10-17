export const RIDE_QUEUE_NAME = 'ride-processing';

export enum RideQueueJob {
  ProcessSelection = 'process-selection',
}

export interface RideQueueJobData {
  rideId: string;
  driverId: string;
}
