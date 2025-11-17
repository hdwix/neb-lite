import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Ride } from '../../domain/entities/ride.entity';
import { RideDriverCandidateRepository } from './ride-driver-candidate.repository';

@Injectable()
export class RideRepository {
  private readonly rideSelectFields = [
    `id::text AS "id"`,
    `rider_id AS "riderId"`,
    `driver_id AS "driverId"`,
    `pickup_lon AS "pickupLongitude"`,
    `pickup_lat AS "pickupLatitude"`,
    `dropoff_lon AS "dropoffLongitude"`,
    `dropoff_lat AS "dropoffLatitude"`,
    `status`,
    `fare_estimated::text AS "fareEstimated"`,
    `fare_final::text AS "fareFinal"`,
    `discount_percent AS "discountPercent"`,
    `discount_amount::text AS "discountAmount"`,
    `app_fee_amount::text AS "appFeeAmount"`,
    `distance_estimated_km AS "distanceEstimatedKm"`,
    `duration_estimated_seconds AS "durationEstimatedSeconds"`,
    `distance_actual_km AS "distanceActualKm"`,
    `payment_url AS "paymentUrl"`,
    `payment_status AS "paymentStatus"`,
    `note`,
    `cancel_reason AS "cancelReason"`,
    `created_at AS "createdAt"`,
    `updated_at AS "updatedAt"`,
    `deleted_at AS "deletedAt"`,
  ].join(',\n          ');

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly candidateRepository: RideDriverCandidateRepository,
  ) {}

  create(data: Partial<Ride>): Ride {
    return Object.assign(new Ride(), data);
  }

  async save(ride: Ride): Promise<Ride> {
    const originalCandidates = ride.candidates;
    const persisted = ride.id
      ? await this.updateRide(ride)
      : await this.insertRide(ride);
    persisted.candidates = originalCandidates;
    return persisted;
  }

  async claimDriver(rideId: string, driverId: string): Promise<boolean> {
    const rows = await this.dataSource.query(
      `
        UPDATE rides
        SET
          driver_id = $2,
          updated_at = NOW()
        WHERE id = $1::bigint
          AND driver_id IS NULL
        RETURNING id;
      `,
      [rideId, driverId],
    );

    return rows?.length > 0;
  }

  async remove(ride: Ride): Promise<Ride> {
    if (!ride.id) {
      return ride;
    }

    await this.dataSource.query(`DELETE FROM rides WHERE id = $1::bigint;`, [
      ride.id,
    ]);
    return ride;
  }

  async findById(id: string): Promise<Ride | null> {
    const rows = await this.dataSource.query(
      `
        SELECT
          ${this.rideSelectFields}
        FROM rides
        WHERE id = $1::bigint
        LIMIT 1;
      `,
      [id],
    );

    if (!rows?.length) {
      return null;
    }

    const ride = this.mapRideRow(rows[0]);
    ride.candidates = await this.candidateRepository.findByRideId(ride.id);
    return ride;
  }

  private async insertRide(ride: Ride): Promise<Ride> {
    const rows = await this.dataSource.query(
      `
        INSERT INTO rides (
          rider_id,
          driver_id,
          pickup_lon,
          pickup_lat,
          dropoff_lon,
          dropoff_lat,
          status,
          fare_estimated,
          fare_final,
          discount_percent,
          discount_amount,
          app_fee_amount,
          distance_estimated_km,
          duration_estimated_seconds,
          distance_actual_km,
          payment_url,
          payment_status,
          note,
          cancel_reason
        ) VALUES (
          $1,
          $2,
          $3::double precision,
          $4::double precision,
          $5::double precision,
          $6::double precision,
          $7,
          $8,
          $9,
          $10,
          $11,
          $12,
          $13,
          $14,
          $15,
          $16,
          $17,
          $18,
          $19
        )
        RETURNING ${this.rideSelectFields};
      `,
      this.extractRideParams(ride),
    );

    if (!rows?.length) {
      throw new Error('Failed to insert ride');
    }

    return this.mapRideRow(rows[0]);
  }

  private async updateRide(ride: Ride): Promise<Ride> {
    if (!ride.id) {
      throw new Error('Ride id is required for updates');
    }

    const rows = await this.dataSource.query(
      `
        UPDATE rides
        SET
          rider_id = $2,
          driver_id = $3,
          pickup_lon = $4::double precision,
          pickup_lat = $5::double precision,
          dropoff_lon = $6::double precision,
          dropoff_lat = $7::double precision,
          status = $8,
          fare_estimated = $9,
          fare_final = $10,
          discount_percent = $11,
          discount_amount = $12,
          app_fee_amount = $13,
          distance_estimated_km = $14,
          duration_estimated_seconds = $15,
          distance_actual_km = $16,
          payment_url = $17,
          payment_status = $18,
          note = $19,
          cancel_reason = $20,
          updated_at = NOW()
        WHERE id = $1::bigint
        RETURNING ${this.rideSelectFields};
      `,
      [ride.id, ...this.extractRideParams(ride)],
    );

    if (!rows?.length) {
      throw new Error('Ride not found while updating');
    }

    return this.mapRideRow(rows[0]);
  }

  private extractRideParams(ride: Ride): unknown[] {
    return [
      ride.riderId,
      ride.driverId ?? null,
      ride.pickupLongitude,
      ride.pickupLatitude,
      ride.dropoffLongitude,
      ride.dropoffLatitude,
      ride.status,
      ride.fareEstimated ?? null,
      ride.fareFinal ?? null,
      ride.discountPercent ?? null,
      ride.discountAmount ?? null,
      ride.appFeeAmount ?? null,
      ride.distanceEstimatedKm ?? null,
      ride.durationEstimatedSeconds ?? null,
      ride.distanceActualKm ?? null,
      ride.paymentUrl ?? null,
      ride.paymentStatus ?? null,
      ride.note ?? null,
      ride.cancelReason ?? null,
    ];
  }

  private mapRideRow(row: Record<string, any>): Ride {
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
    ride.note = row.note ?? null;
    ride.cancelReason = row.cancelReason ?? null;
    ride.createdAt = row.createdAt ? new Date(row.createdAt) : ride.createdAt;
    ride.updatedAt = row.updatedAt ? new Date(row.updatedAt) : ride.updatedAt;
    ride.deletedAt = row.deletedAt ? new Date(row.deletedAt) : null;
    return ride;
  }
}
