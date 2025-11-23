import { Injectable } from '@nestjs/common';
import { ERideStatus } from '../constants/ride-status.enum';
import { Ride } from '../entities/ride.entity';
import { RideDriverCandidate } from '../entities/ride-driver-candidate.entity';

@Injectable()
export class RideResponseService {
  toRideResponse(ride: Ride, candidates?: RideDriverCandidate[]) {
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
}
