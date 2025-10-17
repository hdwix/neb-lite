export const RIDE_QUEUE_NAME = 'ride-processing';

export enum RideQueueJob {
  EstimateRoute = 'estimate-route',
  ProcessSelection = 'process-selection',
}

export interface RideCoordinate {
  lon: number;
  lat: number;
}

export interface RideRouteEstimationJobData {
  rideId: string;
  pickup: RideCoordinate;
  dropoff: RideCoordinate;
}

export interface RideSelectionJobData {
  rideId: string;
  driverId: string;
}

export type RideQueueJobData =
  | RideRouteEstimationJobData
  | RideSelectionJobData;
