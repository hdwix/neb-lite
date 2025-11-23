export const RIDE_QUEUE_NAME = 'ride-processing';

export enum RideQueueJob {
  EstimateRoute = 'estimate-route',
}

export interface RideCoordinate {
  longitude: number;
  latitude: number;
}

export interface RideRouteEstimationJobData {
  rideId: string;
  pickup: RideCoordinate;
  dropoff: RideCoordinate;
}

export type RideQueueJobData = RideRouteEstimationJobData;
