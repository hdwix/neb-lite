export interface DriverLocationInput {
  lon: number;
  lat: number;
  accuracyMeters?: number;
}

export interface DriverLocationEntry extends DriverLocationInput {
  updatedAt: string;
}

export interface NearbyDriver {
  driverId: string;
  distanceMeters: number;
  etaSeconds?: number;
  accuracyMeters?: number;
  updatedAt?: string;
}

export const LOCATION_QUEUE_NAME = 'driver-location';
export const enum LocationQueueJob {
  UpsertDriverLocation = 'upsert-driver-location',
}

export interface LocationUpdateJobData {
  driverId: string;
  location: DriverLocationInput;
  eventTimestamp: string;
}
