import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ERideStatus } from '../constants/ride-status.enum';
import { Ride } from '../entities/ride.entity';
import { RideDriverCandidate } from '../entities/ride-driver-candidate.entity';

@Injectable()
export class RideResponseService {
  private readonly defaultFareRatePerKm: number;

  constructor(private readonly configService: ConfigService) {
    this.defaultFareRatePerKm = this.getNumberConfig(
      'DEFAULT_FARE_RATE_PER_KM',
      3000,
    );
  }

  toRideResponse(ride: Ride, candidates?: RideDriverCandidate[]) {
    const parseCurrency = (value?: string | number | null): number | null => {
      if (value === undefined || value === null) {
        return null;
      }

      const normalized = typeof value === 'string' ? Number(value) : value;

      if (!Number.isFinite(normalized)) {
        return null;
      }

      const rounded = Math.round(normalized * 100) / 100;
      return rounded < 0 ? null : rounded;
    };

    const distanceActualKm = ride.distanceActualKm ?? null;
    const baseFare =
      distanceActualKm !== null
        ? parseCurrency(distanceActualKm * this.defaultFareRatePerKm)
        : null;
    const discountAmountByDriver = parseCurrency(ride.discountAmount) ?? 0;
    const fareAfterDiscount =
      baseFare !== null
        ? Math.max(0, parseCurrency(baseFare - discountAmountByDriver) ?? 0)
        : null;
    const appFeeAmount = parseCurrency(ride.appFeeAmount);
    const finalFare =
      fareAfterDiscount !== null
        ? parseCurrency(fareAfterDiscount + (appFeeAmount ?? 0))
        : parseCurrency(ride.fareFinal);

    const response: any = {
      id: ride.id,
      riderId: ride.riderId,
      driverId: ride.driverId,
      pickup: {
        longitude: ride.pickupLongitude,
        latitude: ride.pickupLatitude,
      },
      dropoff: {
        longitude: ride.dropoffLongitude,
        latitude: ride.dropoffLatitude,
      },
      status: ride.status,
      fareEstimated: ride.fareEstimated ?? null,
      fareFinal: ride.fareFinal ?? null,
      distanceEstimatedKm: ride.distanceEstimatedKm ?? null,
      durationEstimatedSeconds: ride.durationEstimatedSeconds ?? null,
      distanceActualKm: ride.distanceActualKm ?? null,
      discountPercent: ride.discountPercent ?? null,
      discountAmount: ride.discountAmount ?? null,
      appFeeAmount: ride.appFeeAmount ?? null,
      paymentUrl: ride.paymentUrl ?? null,
      paymentStatus: ride.paymentStatus ?? null,
      createdAt: ride.createdAt?.toISOString?.() ?? ride.createdAt,
    };

    if (baseFare !== null) {
      response.baseFare = baseFare.toFixed(2);
      response.fareRatePerKm = this.defaultFareRatePerKm;
      response.discountAmountByDriver = discountAmountByDriver.toFixed(2);
      response.fareAfterDiscount = fareAfterDiscount?.toFixed(2) ?? null;
      response.finalFare = finalFare?.toFixed(2) ?? null;
    }

    if (candidates && ride.status !== ERideStatus.COMPLETED) {
      response.candidates = candidates.map((candidate) => ({
        driverId: candidate.driverId,
        status: candidate.status,
        reason: candidate.reason ?? null,
        distanceMeters: candidate.distanceMeters ?? null,
        respondedAt:
          candidate.respondedAt?.toISOString?.() ??
          candidate.respondedAt ??
          null,
        createdAt:
          candidate.createdAt?.toISOString?.() ?? candidate.createdAt ?? null,
      }));
    }

    return response;
  }

  private getNumberConfig(key: string, defaultValue: number): number {
    const value = this.configService.get(key);

    if (typeof value === 'number') {
      return value;
    }

    if (typeof value === 'string') {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }

    return defaultValue;
  }
}
