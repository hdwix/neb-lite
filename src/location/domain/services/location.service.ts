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
  private readonly averageDriverSpeedMetersPerSecond = 6;

  constructor(@Inject(CACHE_MANAGER) private readonly cacheManager: Cache) {}

  async upsertDriverLocation(
    driverId: string,
    location: DriverLocationInput,
  ): Promise<DriverLocationEntry> {
    const store = await this.getLocationStore();
    const entry: DriverLocationEntry = {
      lon: location.lon,
      lat: location.lat,
      accuracyMeters: location.accuracyMeters,
      updatedAt: new Date().toISOString(),
    };

    store[driverId] = entry;
    await this.cacheManager.set(this.driverLocationCacheKey, store);
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
