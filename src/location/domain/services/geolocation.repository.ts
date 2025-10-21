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
  private readonly temporaryDistanceKeyPrefix = 'geo:distance:temp';

  constructor(private readonly configService: ConfigService) {
    const host = this.configService.get<string>('REDIS_HOST', 'localhost');
    const port = this.configService.get<number>('REDIS_PORT', 6379);

    this.redis = new Redis({ host, port });
    this.redis.on('error', (error) =>
      this.logger.error(`Redis connection error: ${error}`),
    );
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
      .expire(driverLocationKey, 300) // set ttl for driver loc hash to 5 minutes
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

  // async calculateDistanceKm(
  //   origin: Pick<DriverLocationInput, 'longitude' | 'latitude'>,
  //   destination: Pick<DriverLocationInput, 'longitude' | 'latitude'>,
  // ): Promise<number | null> {
  //   const key = `${this.temporaryDistanceKeyPrefix}:${randomUUID()}`;

  //   try {
  //     const result = (await this.redis.eval(
  //       `
  //         local key = KEYS[1]
  //         local originMember = ARGV[1]
  //         local originLon = tonumber(ARGV[2])
  //         local originLat = tonumber(ARGV[3])
  //         local destinationMember = ARGV[4]
  //         local destinationLon = tonumber(ARGV[5])
  //         local destinationLat = tonumber(ARGV[6])
  //         local unit = ARGV[7]

  //         if not originLon or not originLat or not destinationLon or not destinationLat then
  //           return nil
  //         end

  //         redis.call('DEL', key)
  //         redis.call('GEOADD', key, originLon, originLat, originMember)
  //         redis.call('GEOADD', key, destinationLon, destinationLat, destinationMember)
  //         local distance = redis.call('GEODIST', key, originMember, destinationMember, unit)
  //         redis.call('DEL', key)

  //         return distance
  //       `,
  //       1,
  //       key,
  //       'origin',
  //       origin.longitude.toString(),
  //       origin.latitude.toString(),
  //       'destination',
  //       destination.longitude.toString(),
  //       destination.latitude.toString(),
  //       'km',
  //     )) as number | string | null;

  //     if (result === null) {
  //       return null;
  //     }

  //     const distance = Number(result);
  //     return Number.isFinite(distance) ? distance : null;
  //   } catch (error) {
  //     this.logger.warn(
  //       `Failed to calculate distance via Redis GEO operations: ${error}`,
  //     );
  //     return null;
  //   }
  // }

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

  //   private async getDriverMetadata(
  //     driverId: string,
  //   ): Promise<DriverLocationEntry | null> {
  //     const metadataValue = await this.redis.hget(
  //       this.driverMetadataKey,
  //       driverId,
  //     );

  //     if (!metadataValue) {
  //       return null;
  //     }

  //     try {
  //       return JSON.parse(metadataValue) as DriverLocationEntry;
  //     } catch (error) {
  //       this.logger.warn(
  //         `Unable to parse metadata for driver ${driverId}: ${error}`,
  //       );
  //       return null;
  //     }
  //   }
}

export type { GeospatialQueryResult };
