import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Ride } from '../../domain/entities/ride.entity';
import { RideDriverCandidate } from '../../domain/entities/ride-driver-candidate.entity';

@Injectable()
export class RidePaymentRepository {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async findById(rideId: string): Promise<Ride | null> {
    const rides = await this.dataSource.query(
      `
        SELECT
          id::text AS "id",
          rider_id AS "riderId",
          driver_id AS "driverId",
          pickup_lon AS "pickupLongitude",
          pickup_lat AS "pickupLatitude",
          dropoff_lon AS "dropoffLongitude",
          dropoff_lat AS "dropoffLatitude",
          status,
          fare_estimated::text AS "fareEstimated",
          fare_final::text AS "fareFinal",
          discount_percent AS "discountPercent",
          discount_amount::text AS "discountAmount",
          app_fee_amount::text AS "appFeeAmount",
          distance_estimated_km AS "distanceEstimatedKm",
          duration_estimated_seconds AS "durationEstimatedSeconds",
          distance_actual_km AS "distanceActualKm",
          payment_url AS "paymentUrl",
          payment_status AS "paymentStatus",
          created_at AS "createdAt"
        FROM rides
        WHERE id = $1::bigint
        LIMIT 1;
      `,
      [rideId],
    );

    if (!rides?.length) {
      return null;
    }

    const ride = this.mapRideRowToEntity(rides[0]);
    ride.candidates = await this.findCandidatesForRide(rideId);
    return ride;
  }

  async updatePaymentState(
    rideId: string,
    paymentStatus: string | null,
    paymentUrl: string | null,
  ): Promise<void> {
    const rows = await this.dataSource.query(
      `
        UPDATE rides
        SET
          payment_status = $2,
          payment_url = $3,
          updated_at = NOW()
        WHERE id = $1::bigint
        RETURNING id;
      `,
      [rideId, paymentStatus ?? null, paymentUrl ?? null],
    );

    if (!rows?.length) {
      throw new Error('Ride not found while updating payment state');
    }
  }

  private async findCandidatesForRide(
    rideId: string,
  ): Promise<RideDriverCandidate[]> {
    const rows = await this.dataSource.query(
      `
        SELECT
          driver_id AS "driverId",
          status,
          reason,
          distance_meters AS "distanceMeters",
          responded_at AS "respondedAt",
          created_at AS "createdAt"
        FROM ride_driver_candidates
        WHERE ride_id = $1::bigint
        ORDER BY created_at ASC;
      `,
      [rideId],
    );

    return (rows ?? []).map((row) => this.mapCandidateRow(row));
  }

  private mapRideRowToEntity(row: Record<string, any>): Ride {
    const ride = new Ride();
    ride.id = row.id?.toString?.() ?? row.id ?? ride.id;
    ride.riderId = row.riderId ?? ride.riderId;
    ride.driverId = row.driverId ?? null;
    if (row.pickupLongitude !== undefined && row.pickupLongitude !== null) {
      ride.pickupLongitude = Number(row.pickupLongitude);
    }
    if (row.pickupLatitude !== undefined && row.pickupLatitude !== null) {
      ride.pickupLatitude = Number(row.pickupLatitude);
    }
    if (row.dropoffLongitude !== undefined && row.dropoffLongitude !== null) {
      ride.dropoffLongitude = Number(row.dropoffLongitude);
    }
    if (row.dropoffLatitude !== undefined && row.dropoffLatitude !== null) {
      ride.dropoffLatitude = Number(row.dropoffLatitude);
    }
    ride.status = row.status ?? ride.status;
    ride.fareEstimated = row.fareEstimated ?? ride.fareEstimated;
    ride.fareFinal = row.fareFinal ?? ride.fareFinal;
    ride.discountPercent =
      row.discountPercent !== undefined && row.discountPercent !== null
        ? Number(row.discountPercent)
        : null;
    ride.discountAmount = row.discountAmount ?? ride.discountAmount;
    ride.appFeeAmount = row.appFeeAmount ?? ride.appFeeAmount;
    ride.distanceEstimatedKm =
      row.distanceEstimatedKm !== undefined && row.distanceEstimatedKm !== null
        ? Number(row.distanceEstimatedKm)
        : null;
    ride.durationEstimatedSeconds =
      row.durationEstimatedSeconds !== undefined &&
      row.durationEstimatedSeconds !== null
        ? Number(row.durationEstimatedSeconds)
        : null;
    ride.distanceActualKm =
      row.distanceActualKm !== undefined && row.distanceActualKm !== null
        ? Number(row.distanceActualKm)
        : null;
    ride.paymentUrl = row.paymentUrl ?? null;
    ride.paymentStatus = row.paymentStatus ?? null;
    ride.createdAt = row.createdAt ? new Date(row.createdAt) : ride.createdAt;
    return ride;
  }

  private mapCandidateRow(row: Record<string, any>): RideDriverCandidate {
    const candidate = new RideDriverCandidate();
    candidate.driverId = row.driverId ?? candidate.driverId;
    candidate.status = row.status ?? candidate.status;
    candidate.reason = row.reason ?? null;
    candidate.distanceMeters =
      row.distanceMeters !== undefined && row.distanceMeters !== null
        ? Number(row.distanceMeters)
        : candidate.distanceMeters;
    candidate.respondedAt = row.respondedAt
      ? new Date(row.respondedAt)
      : candidate.respondedAt;
    candidate.createdAt = row.createdAt
      ? new Date(row.createdAt)
      : candidate.createdAt;
    return candidate;
  }
}
