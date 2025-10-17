import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { randomUUID } from 'crypto';
import { DriverLocationEntry, DriverLocationInput } from './location.types';

interface GeospatialQueryResult {
  driverId: string;
  distanceMeters: number;
  location: {
    lon: number;
    lat: number;
  };
  metadata?: Pick<DriverLocationEntry, 'accuracyMeters' | 'updatedAt'>;
}

@Injectable()
export class GeolocationRepository implements OnModuleDestroy {
  private readonly logger = new Logger(GeolocationRepository.name);
  private readonly redis: Redis;
  private readonly driverGeoKey = 'geo:drivers';
  private readonly driverMetadataKey = 'geo:drivers:metadata';
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
  ): Promise<DriverLocationEntry> {
    const timestamp = eventTimestamp ?? new Date().toISOString();
    const entry: DriverLocationEntry = {
      lon: location.lon,
      lat: location.lat,
      accuracyMeters: location.accuracyMeters,
      updatedAt: timestamp,
    };

    if (!Number.isFinite(entry.lon) || !Number.isFinite(entry.lat)) {
      throw new Error('Invalid driver coordinates');
    }

    const result = (await this.redis.eval(
      `
      local metadataKey = KEYS[1]
      local geoKey = KEYS[2]
      local driverId = ARGV[1]
      local lon = tonumber(ARGV[2])
      local lat = tonumber(ARGV[3])
      local metadataValue = ARGV[4]
      local updatedAt = ARGV[5]

      local existing = redis.call('HGET', metadataKey, driverId)
      if existing then
        local ok, decoded = pcall(cjson.decode, existing)
        if ok and decoded and decoded.updatedAt and decoded.updatedAt >= updatedAt then
          return 0
        end
      end

      redis.call('GEOADD', geoKey, lon, lat, driverId)
      redis.call('HSET', metadataKey, driverId, metadataValue)
      return 1
    `,
      2,
      this.driverMetadataKey,
      this.driverGeoKey,
      driverId,
      entry.lon.toString(),
      entry.lat.toString(),
      JSON.stringify(entry),
      entry.updatedAt,
    )) as number | string | null;

    if (Number(result) === 1) {
      this.logger.log(`Stored geospatial location for driver ${driverId}`);
      return entry;
    }

    this.logger.log(
      `Skipped outdated location update for driver ${driverId} (event timestamp: ${entry.updatedAt})`,
    );

    const existingEntry = await this.getDriverMetadata(driverId);
    return existingEntry ?? entry;
  }

  async getNearbyDrivers(
    lon: number,
    lat: number,
    radiusMeters: number,
    limit: number,
  ): Promise<GeospatialQueryResult[]> {
    const rawResults = await this.redis.georadius(
      this.driverGeoKey,
      lon,
      lat,
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

    const metadataResults = driverIds.length
      ? await this.redis.hmget(this.driverMetadataKey, ...driverIds)
      : [];

    const metadataMap = new Map<string, GeospatialQueryResult['metadata']>();
    driverIds.forEach((driverId, index) => {
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
      .map((entry) => this.mapGeoradiusEntry(entry, metadataMap))
      .filter((result): result is GeospatialQueryResult => result !== null);
  }

  async calculateDistanceKm(
    origin: Pick<DriverLocationInput, 'lon' | 'lat'>,
    destination: Pick<DriverLocationInput, 'lon' | 'lat'>,
  ): Promise<number | null> {
    const key = `${this.temporaryDistanceKeyPrefix}:${randomUUID()}`;

    try {
      const result = (await this.redis.eval(
        `
          local key = KEYS[1]
          local originMember = ARGV[1]
          local originLon = tonumber(ARGV[2])
          local originLat = tonumber(ARGV[3])
          local destinationMember = ARGV[4]
          local destinationLon = tonumber(ARGV[5])
          local destinationLat = tonumber(ARGV[6])
          local unit = ARGV[7]

          if not originLon or not originLat or not destinationLon or not destinationLat then
            return nil
          end

          redis.call('DEL', key)
          redis.call('GEOADD', key, originLon, originLat, originMember)
          redis.call('GEOADD', key, destinationLon, destinationLat, destinationMember)
          local distance = redis.call('GEODIST', key, originMember, destinationMember, unit)
          redis.call('DEL', key)

          return distance
        `,
        1,
        key,
        'origin',
        origin.lon.toString(),
        origin.lat.toString(),
        'destination',
        destination.lon.toString(),
        destination.lat.toString(),
        'km',
      )) as number | string | null;

      if (result === null) {
        return null;
      }

      const distance = Number(result);
      return Number.isFinite(distance) ? distance : null;
    } catch (error) {
      this.logger.warn(`Failed to calculate distance via Redis GEO operations: ${error}`);
      return null;
    }
  }

  private mapGeoradiusEntry(
    entry: unknown,
    metadataMap: Map<string, GeospatialQueryResult['metadata']>,
  ): GeospatialQueryResult | null {
    if (!Array.isArray(entry) || entry.length < 3) {
      return null;
    }

    const [driverIdRaw, distanceRaw, coordinatesRaw] = entry;
    if (typeof driverIdRaw !== 'string') {
      return null;
    }

    const [lonRaw, latRaw] = Array.isArray(coordinatesRaw)
      ? coordinatesRaw
      : [undefined, undefined];

    const lon = Number(lonRaw);
    const lat = Number(latRaw);
    const distanceMeters = Number(distanceRaw);

    if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
      return null;
    }

    return {
      driverId: driverIdRaw,
      distanceMeters: Number.isFinite(distanceMeters) ? distanceMeters : 0,
      location: {
        lon,
        lat,
      },
      metadata: metadataMap.get(driverIdRaw),
    };
  }

  private async getDriverMetadata(
    driverId: string,
  ): Promise<DriverLocationEntry | null> {
    const metadataValue = await this.redis.hget(
      this.driverMetadataKey,
      driverId,
    );

    if (!metadataValue) {
      return null;
    }

    try {
      return JSON.parse(metadataValue) as DriverLocationEntry;
    } catch (error) {
      this.logger.warn(
        `Unable to parse metadata for driver ${driverId}: ${error}`,
      );
      return null;
    }
  }
}

export type { GeospatialQueryResult };
