import { Cache, CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable, Logger } from '@nestjs/common';

interface DriverLocationEntry {
  lon: number;
  lat: number;
  accuracyMeters?: number;
  updatedAt: string;
}

interface DriverLocationInput {
  lon: number;
  lat: number;
  accuracyMeters?: number;
}

interface NearbyDriver {
  driverId: string;
  distanceMeters: number;
  etaSeconds?: number;
}

type DriverLocationStore = Record<string, DriverLocationEntry>;

@Injectable()
export class LocationService {
  private readonly logger = new Logger(LocationService.name);
  private readonly driverLocationCacheKey = 'location:drivers';
  private readonly driverLocationCachePrefix = 'location:driver';
  private readonly averageDriverSpeedMetersPerSecond = 6;

  constructor(@Inject(CACHE_MANAGER) private readonly cacheManager: Cache) {}

  async upsertDriverLocation(
    driverId: string,
    location: DriverLocationInput,
  ): Promise<DriverLocationEntry> {
    const entry: DriverLocationEntry = {
      lon: location.lon,
      lat: location.lat,
      accuracyMeters: location.accuracyMeters,
      updatedAt: new Date().toISOString(),
    };

    await this.cacheManager.set(
      this.getDriverLocationCacheKey(driverId),
      entry,
    );
    this.logger.debug(`Location updated for driver ${driverId}`);
    return entry;
  }

  async getNearbyDrivers(
    lon: number,
    lat: number,
    radiusMeters = 3000,
    limit = 10,
  ): Promise<NearbyDriver[]> {
    const store = await this.getLocationStore();

    const drivers = Object.entries(store)
      .map(([driverId, location]) => {
        const distance = this.getDistanceInMeters(
          lat,
          lon,
          location.lat,
          location.lon,
        );
        return {
          driverId,
          distanceMeters: distance,
          etaSeconds: this.calculateEtaSeconds(distance),
        };
      })
      .filter((driver) => driver.distanceMeters <= radiusMeters)
      .sort((a, b) => a.distanceMeters - b.distanceMeters)
      .slice(0, limit);

    return drivers;
  }

  private async getLocationStore(): Promise<DriverLocationStore> {
    const entries = await this.getDriverLocationEntries();
    if (entries.length > 0) {
      return Object.fromEntries(entries);
    }

    const cached = await this.cacheManager.get<DriverLocationStore>(
      this.driverLocationCacheKey,
    );
    if (cached && typeof cached === 'object') {
      return Object.fromEntries(
        Object.entries(cached).map(([driverId, location]) => [
          driverId,
          { ...location },
        ]),
      );
    }
    return {};
  }

  private async getDriverLocationEntries(): Promise<
    Array<[string, DriverLocationEntry]>
  > {
    const keys = await this.getDriverLocationKeys();
    if (keys.length === 0) {
      return [];
    }

    const entries = await Promise.all(
      keys.map(async (key) => {
        const driverId = this.extractDriverIdFromKey(key);
        if (!driverId) {
          return null;
        }
        const location = await this.cacheManager.get<DriverLocationEntry>(key);
        if (!location || typeof location !== 'object') {
          return null;
        }
        return [driverId, { ...location }] as [
          string,
          DriverLocationEntry,
        ];
      }),
    );

    return entries.filter(
      (entry): entry is [string, DriverLocationEntry] => Boolean(entry),
    );
  }

  private async getDriverLocationKeys(): Promise<string[]> {
    const store: unknown = (this.cacheManager as unknown as { store?: unknown })
      ?.store;
    const cacheStore = store as {
      keys?: (...args: unknown[]) => unknown;
    };

    if (cacheStore?.keys) {
      const pattern = `${this.driverLocationCachePrefix}:*`;
      try {
        const keys = await this.invokeCacheKeys(cacheStore.keys, pattern);
        if (Array.isArray(keys) && keys.length > 0) {
          return keys;
        }
      } catch (error) {
        this.logger.debug(
          `Unable to list driver location keys using pattern lookup: ${error}`,
        );
      }
    }

    const cached = await this.cacheManager.get<DriverLocationStore>(
      this.driverLocationCacheKey,
    );
    if (cached && typeof cached === 'object') {
      return Object.keys(cached).map((driverId) =>
        this.getDriverLocationCacheKey(driverId),
      );
    }

    return [];
  }

  private getDriverLocationCacheKey(driverId: string): string {
    return `${this.driverLocationCachePrefix}:${driverId}`;
  }

  private extractDriverIdFromKey(key: string): string | null {
    const prefix = `${this.driverLocationCachePrefix}:`;
    if (key.startsWith(prefix)) {
      return key.slice(prefix.length);
    }
    return null;
  }

  private async invokeCacheKeys(
    keysFn: (...args: unknown[]) => unknown,
    pattern: string,
  ): Promise<string[]> {
    if (keysFn.length >= 2) {
      return new Promise<string[]>((resolve, reject) => {
        (keysFn as (pattern: string, cb: (err: unknown, result?: unknown) => void) => void)(
          pattern,
          (err, result) => {
            if (err) {
              reject(err);
              return;
            }
            resolve(Array.isArray(result) ? result : []);
          },
        );
      });
    }

    const result = keysFn(pattern);
    if (Array.isArray(result)) {
      return result;
    }
    if (result && typeof (result as Promise<unknown>).then === 'function') {
      const awaited = await (result as Promise<unknown>);
      return Array.isArray(awaited) ? awaited : [];
    }
    return [];
  }

  private getDistanceInMeters(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number,
  ): number {
    const earthRadiusMeters = 6371000;
    const latDistance = this.toRadians(lat2 - lat1);
    const lonDistance = this.toRadians(lon2 - lon1);

    const a =
      Math.sin(latDistance / 2) * Math.sin(latDistance / 2) +
      Math.cos(this.toRadians(lat1)) *
        Math.cos(this.toRadians(lat2)) *
        Math.sin(lonDistance / 2) *
        Math.sin(lonDistance / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return earthRadiusMeters * c;
  }

  private toRadians(degrees: number): number {
    return (degrees * Math.PI) / 180;
  }

  private calculateEtaSeconds(distanceMeters: number): number | undefined {
    if (this.averageDriverSpeedMetersPerSecond <= 0) {
      return undefined;
    }
    return Math.round(distanceMeters / this.averageDriverSpeedMetersPerSecond);
  }
}
