import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
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
      this.logger.debug(`Stored geospatial location for driver ${driverId}`);
      return entry;
    }

    this.logger.debug(
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
      .filter(
        (result): result is GeospatialQueryResult => result !== null,
      );
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
