import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { randomUUID } from 'crypto';
import {
  ACTIVE_DRIVER_LOC_ZSET,
  DRIVER_LOC_GEO_KEY,
  DRIVER_LOC_HASH_PREFIX,
  DRIVER_METADATA_HASH_KEY,
  DriverLocationEntry,
  DriverLocationInput,
  THRESHOLD_DRIVER_IDLE_MS,
} from './location.types';

interface GeospatialQueryResult {
  driverId: string;
  distanceMeters: number;
  location: {
    longitude: number;
    latitude: number;
  };
  metadata?: Pick<DriverLocationEntry, 'accuracyMeters' | 'updatedAt'>;
}

@Injectable()
export class GeolocationRepository implements OnModuleDestroy {
  private readonly logger = new Logger(GeolocationRepository.name);
  private readonly redis: Redis;
  private readonly driverLocationTtlSeconds: number;
  private readonly temporaryDistanceKeyPrefix = 'geo:distance:temp';

  constructor(private readonly configService: ConfigService) {
    const host = this.configService.get<string>('REDIS_HOST', 'localhost');
    const port = this.configService.get<number>('REDIS_PORT', 6379);

    this.redis = new Redis({ host, port });
    this.redis.on('error', (error) =>
      this.logger.error(`Redis connection error: ${error}`),
    );

    const defaultTtlSeconds = 300;
    const configuredTtl = this.configService.get('DRIVER_LOCATION_TTL_SECONDS');
    const parsedTtl = Number(configuredTtl);

    if (Number.isFinite(parsedTtl) && parsedTtl > 0) {
      this.driverLocationTtlSeconds = Math.max(180, Math.floor(parsedTtl));
    } else {
      this.driverLocationTtlSeconds = defaultTtlSeconds;
    }
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.redis.quit();
    } catch (error) {
      this.logger.warn(`Failed to close redis connection: ${error}`);
    }
  }

  async storeDriverLocation(
    driverId: string,
    location: DriverLocationInput,
    eventTimestamp?: string,
  ): Promise<void> {
    const timestamp = eventTimestamp ?? new Date().toISOString();
    const entry: DriverLocationEntry = {
      longitude: location.longitude,
      latitude: location.latitude,
      accuracyMeters: location.accuracyMeters,
      updatedAt: timestamp,
    };

    const driverLocationKey = `${DRIVER_LOC_HASH_PREFIX}${driverId}`;

    await this.redis
      .multi()
      // Adds/updates the driver’s coordinate in a GEO sorted set. This enables GEOSEARCH radius/box queries to find nearby drivers.
      .geoadd(
        DRIVER_LOC_GEO_KEY,
        location.longitude,
        location.latitude,
        driverId,
      )
      .hset(driverLocationKey, {
        // Writes the driver’s latest location metadata to a hash at a stable per-driver key. Any service can later HGETALL driver:loc:<id> to fetch the latest snapshot.
        longitude: String(location.longitude),
        latitude: String(location.latitude),
        accuracyMeters: String(location.accuracyMeters ?? 0),
        updatedAt: timestamp,
      })
      .hset(DRIVER_METADATA_HASH_KEY, driverId, JSON.stringify(entry))
      .expire(driverLocationKey, this.driverLocationTtlSeconds) // configurable TTL for driver location hash
      .zadd(ACTIVE_DRIVER_LOC_ZSET, Date.now(), driverId) // This gives a quick way to list recently active drivers
      .publish(
        'drivers:loc:updates', // Sends a Pub/Sub message to the channel drivers:loc:updates
        JSON.stringify({
          driverId,
          ...entry,
        }),
      )
      .exec();

    this.logger.log(
      `success store update location data for driverId: ${driverId}`,
    );
  }

  async getNearbyDrivers(
    longitude: number,
    latitude: number,
    radiusMeters: number,
    limit: number,
  ): Promise<GeospatialQueryResult[]> {
    const rawResults = await this.redis.georadius(
      DRIVER_LOC_GEO_KEY,
      longitude,
      latitude,
      radiusMeters,
      'm',
      'WITHDIST',
      'WITHCOORD',
      'COUNT',
      limit,
      'ASC',
    );

    if (!Array.isArray(rawResults) || rawResults.length === 0) {
      return [];
    }

    const driverIds = rawResults
      .map((entry) => entry?.[0])
      .filter((value): value is string => typeof value === 'string');

    const cutoff = Date.now() - THRESHOLD_DRIVER_IDLE_MS;
    const scoreResults = driverIds.length
      ? await this.redis.zmscore(ACTIVE_DRIVER_LOC_ZSET, ...driverIds)
      : [];

    const activeDriverIds: string[] = [];
    driverIds.forEach((driverId, index) => {
      const scoreRaw = scoreResults[index];
      if (scoreRaw === null || scoreRaw === undefined) {
        return;
      }

      const score = Number(scoreRaw);
      if (!Number.isFinite(score) || score < cutoff) {
        return;
      }

      activeDriverIds.push(driverId);
    });

    if (activeDriverIds.length === 0) {
      return [];
    }

    const activeDriverSet = new Set(activeDriverIds);

    const metadataResults = activeDriverIds.length
      ? await this.redis.hmget(DRIVER_METADATA_HASH_KEY, ...activeDriverIds)
      : [];

    const metadataMap = new Map<string, GeospatialQueryResult['metadata']>();
    activeDriverIds.forEach((driverId, index) => {
      const metadataValue = metadataResults[index];
      if (!metadataValue) {
        return;
      }
      try {
        const parsed = JSON.parse(metadataValue) as DriverLocationEntry;
        metadataMap.set(driverId, {
          accuracyMeters: parsed.accuracyMeters,
          updatedAt: parsed.updatedAt,
        });
      } catch (error) {
        this.logger.warn(
          `Unable to parse metadata for driver ${driverId}: ${error}`,
        );
      }
    });

    return rawResults
      .map((entry) =>
        this.mapGeoradiusEntry(entry, metadataMap, activeDriverSet),
      )
      .filter((result): result is GeospatialQueryResult => result !== null);
  }

  private mapGeoradiusEntry(
    entry: unknown,
    metadataMap: Map<string, GeospatialQueryResult['metadata']>,
    activeDriverSet: Set<string>,
  ): GeospatialQueryResult | null {
    if (!Array.isArray(entry) || entry.length < 3) {
      return null;
    }

    const [driverIdRaw, distanceRaw, coordinatesRaw] = entry;
    if (typeof driverIdRaw !== 'string') {
      return null;
    }

    if (!activeDriverSet.has(driverIdRaw)) {
      return null;
    }

    const [longitudeRaw, latitudeRaw] = Array.isArray(coordinatesRaw)
      ? coordinatesRaw
      : [undefined, undefined];

    const longitude = Number(longitudeRaw);
    const latitude = Number(latitudeRaw);
    const distanceMeters = Number(distanceRaw);

    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
      return null;
    }

    return {
      driverId: driverIdRaw,
      distanceMeters: Number.isFinite(distanceMeters) ? distanceMeters : 0,
      location: {
        longitude,
        latitude,
      },
      metadata: metadataMap.get(driverIdRaw),
    };
  }
}

export type { GeospatialQueryResult };
