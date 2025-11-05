export const TRIP_TRACKING_QUEUE_NAME = 'trip-tracking';

export enum TripTrackingQueueJob {
  FlushAll = 'flush-all',
  FlushRide = 'flush-ride',
}

export interface FlushRideJobData {
  rideId: string;
}

export type TripTrackingJobData =
  | FlushRideJobData
  | Record<string, never>;
