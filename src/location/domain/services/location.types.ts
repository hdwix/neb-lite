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

export const MAINTENANCE_CLEANUP_IDLE_DRIVERS = 'cleanup-idle-drivers';
export const MaintenanceJob = {
  CleanupIdleDrivers: 'cleanup-idle-drivers',
} as const;

export type MaintenanceJobName =
  (typeof MaintenanceJob)[keyof typeof MaintenanceJob];

// tune these to your needs
export const THRESHOLD_DRIVER_IDLE_MS = 3 * 60 * 1000; // 3 minutes idle threshold
export const JOB_CLEANUP_IDLE_LOC_EVERY_MS = 60_000; // run every 60s
export const CLEANUP_DRIVER_IDLE_LOC_BATCH = 1000; // remove in chunks
export const DRIVER_LOC_GEO_KEY = 'drivers:geo';
export const ACTIVE_DRIVER_LOC_ZSET = 'drivers:active';
export const DRIVER_LOC_HASH_PREFIX = 'driver:loc:';
