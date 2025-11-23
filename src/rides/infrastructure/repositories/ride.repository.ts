import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Ride } from '../../domain/entities/ride.entity';
import { RideDriverCandidate } from '../../domain/entities/ride-driver-candidate.entity';
import { ERideDriverCandidateStatus } from '../../domain/constants/ride-driver-candidate-status.enum';
import { ERideStatus } from '../../domain/constants/ride-status.enum';
import { NearbyDriver } from '../../../location/domain/services/location.types';

type RideInsertAttributes = {
  riderId: string;
  driverId?: string | null;
  pickupLongitude: number;
  pickupLatitude: number;
  dropoffLongitude: number;
  dropoffLatitude: number;
  status: ERideStatus;
  fareEstimated?: string | null;
  fareFinal?: string | null;
  discountPercent?: number | null;
  discountAmount?: string | null;
  appFeeAmount?: string | null;
  distanceEstimatedKm?: number | null;
  durationEstimatedSeconds?: number | null;
  distanceActualKm?: number | null;
  paymentUrl?: string | null;
  paymentStatus?: string | null;
  note?: string | null;
  cancelReason?: string | null;
};

export type RideCreationCandidateInput = {
  driverId: string;
  status: ERideDriverCandidateStatus;
  distanceMeters?: number | null;
  reason?: string | null;
  respondedAt?: Date | null;
};

export type RideHistoryCreationInput = {
  fromStatus: ERideStatus | null;
  toStatus: ERideStatus;
  context?: string | null;
};

export interface RideCreationOptions {
  ride: RideInsertAttributes;
  nearbyDrivers: NearbyDriver[];
  historyEntries: RideHistoryCreationInput[];
}

@Injectable()
export class RideRepository {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  create(data: Partial<Ride>): Ride {
    return Object.assign(new Ride(), data);
  }

  async claimDriver(rideId: string, driverId: string): Promise<boolean> {
    const queryRunner = this.dataSource.createQueryRunner();
    try {
      await queryRunner.connect();
      await queryRunner.startTransaction();

      const rideRows: Array<{ driver_id: string | null }> =
        await queryRunner.query(
          `
        SELECT driver_id::text AS driver_id
        FROM rides
        WHERE id = $1::bigint
        FOR UPDATE;
      `,
          [rideId],
        );

      if (!rideRows?.length) {
        throw new Error('Ride not found');
      }

      if (rideRows[0].driver_id) {
        // already claimed by someone else
        throw new Error('Ride already claimed');
      }

      const updateRows = await queryRunner.query(
        `
        UPDATE rides
        SET
          driver_id = $2::bigint,
          updated_at = NOW()
        WHERE id = $1::bigint
          AND driver_id IS NULL
        RETURNING id;
      `,
        [rideId, driverId],
      );

      await queryRunner.commitTransaction();
      return updateRows?.length > 0;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
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
          id,
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
          cancel_reason,
          created_at,
          updated_at,
          deleted_at
        FROM rides
        WHERE id = $1::bigint
        LIMIT 1;
      `,
      [id],
    );

    if (!rows?.length) {
      return null;
    }

    return this.mapRideRow(rows[0]);
  }

  async findUnfinishedRideByRiderId(riderId: string): Promise<Ride | null> {
    const rows = await this.dataSource.query(
      `
        SELECT
          id,
          rider_id,
          status
        FROM rides
        WHERE rider_id = $1::bigint
          AND status NOT IN ($2, $3)
        ORDER BY created_at DESC
        LIMIT 1;
      `,
      [riderId, ERideStatus.COMPLETED, ERideStatus.CANCELED],
    );

    if (!rows?.length) {
      return null;
    }

    return this.mapRideRow(rows[0]);
  }

  async updateRide(ride: Ride): Promise<Ride> {
    if (!ride.id) {
      throw new Error('Ride id is required for updates');
    }

    const current = await this.findById(ride.id);
    if (!current) {
      throw new Error('Ride not found while updating');
    }

    const merged = this.mergeRideData(current, ride);
    const params = this.extractRideParams(merged);

    const rows = await this.dataSource.query(
      `
        UPDATE rides
        SET
          rider_id = $2::bigint,
          driver_id = $3::bigint,
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
        RETURNING id;
      `,
      [merged.id, ...params],
    );

    if (!rows?.length) {
      throw new Error('Ride not found while updating');
    }

    const persisted = await this.findById(merged.id);
    if (!persisted) {
      throw new Error('Ride not found after update');
    }
    return persisted;
  }

  async createRideWithDetails(options: RideCreationOptions): Promise<{
    ride: Ride;
    candidates: RideDriverCandidate[];
  }> {
    const queryRunner = this.dataSource.createQueryRunner();

    try {
      await queryRunner.connect();
      await queryRunner.startTransaction();

      const {
        riderId,
        pickupLongitude,
        pickupLatitude,
        dropoffLongitude,
        dropoffLatitude,
        status,
        fareEstimated,
        distanceEstimatedKm,
        durationEstimatedSeconds,
        note,
      } = options.ride;

      const rideRows = await queryRunner.query(
        `
        INSERT INTO rides (
          rider_id,
          pickup_lon,
          pickup_lat,
          dropoff_lon,
          dropoff_lat,
          status,
          fare_estimated,
          distance_estimated_km,
          duration_estimated_seconds,
          note
        ) VALUES (
          $1::bigint,
          $2::double precision,
          $3::double precision,
          $4::double precision,
          $5::double precision,
          $6,
          $7,
          $8,
          $9,
          $10
        )
        RETURNING id;
      `,
        [
          riderId,
          pickupLongitude,
          pickupLatitude,
          dropoffLongitude,
          dropoffLatitude,
          status,
          fareEstimated ?? null,
          distanceEstimatedKm ?? null,
          durationEstimatedSeconds ?? null,
          note ?? null,
        ],
      );

      if (!rideRows?.length) {
        throw new Error('Failed to create ride');
      }

      const rideIdValue = rideRows[0].id;
      const rideId = rideIdValue?.toString?.();

      const candidateRowsArrays = await Promise.all(
        (options.nearbyDrivers ?? []).map((driver) => {
          const distanceMeters =
            driver.distanceMeters == null
              ? null
              : Math.round(Number(driver.distanceMeters));

          return queryRunner.query(
            `
            INSERT INTO ride_driver_candidates (
              ride_id,
              driver_id,
              status,
              distance_meters
            ) VALUES (
              $1::bigint,
              $2::bigint,
              $3,
              $4
            )
            RETURNING
              id,
              ride_id,
              driver_id,
              status,
              distance_meters,
              reason,
              responded_at,
              created_at,
              updated_at;
          `,
            [
              rideId,
              driver.driverId,
              ERideDriverCandidateStatus.INVITED,
              distanceMeters,
            ],
          );
        }),
      );

      const candidateEntities: RideDriverCandidate[] = candidateRowsArrays.map(
        (rows) => this.mapCandidateRow(rows[0]),
      );

      if (options.historyEntries?.length) {
        for (const entry of options.historyEntries) {
          await queryRunner.query(
            `
            INSERT INTO ride_status_history (
              ride_id,
              from_status,
              to_status,
              context
            ) VALUES (
              $1::bigint,
              $2,
              $3,
              $4
            );
          `,
            [
              rideId,
              entry.fromStatus ?? null,
              entry.toStatus,
              entry.context ?? null,
            ],
          );
        }
      }

      await queryRunner.commitTransaction();

      const ride = await this.findById(rideId);
      if (!ride) {
        throw new Error('Failed to load ride after creation');
      }

      return { ride, candidates: candidateEntities };
    } catch (error) {
      if (queryRunner.isTransactionActive) {
        await queryRunner.rollbackTransaction();
      }
      throw error;
    } finally {
      await queryRunner.release();
    }
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

  private mapCandidateRow(row: Record<string, any>): RideDriverCandidate {
    const candidate = new RideDriverCandidate();
    candidate.id = row.id?.toString?.() ?? row.id ?? candidate.id;
    candidate.rideId =
      row.ride_id?.toString?.() ?? row.rideId?.toString?.() ?? candidate.rideId;
    candidate.driverId =
      row.driver_id?.toString?.() ??
      row.driverId?.toString?.() ??
      candidate.driverId;
    candidate.status = row.status ?? null;
    candidate.distanceMeters =
      row.distance_meters !== undefined && row.distance_meters !== null
        ? Number(row.distance_meters)
        : (candidate.distanceMeters ?? null);
    candidate.reason = row.reason ?? null;
    candidate.respondedAt = row.responded_at
      ? new Date(row.responded_at)
      : row.respondedAt
        ? new Date(row.respondedAt)
        : (candidate.respondedAt ?? null);
    candidate.createdAt = row.created_at
      ? new Date(row.created_at)
      : row.createdAt
        ? new Date(row.createdAt)
        : candidate.createdAt;
    candidate.updatedAt = row.updated_at
      ? new Date(row.updated_at)
      : row.updatedAt
        ? new Date(row.updatedAt)
        : candidate.updatedAt;
    return candidate;
  }

  private mapRideRow(row: Record<string, any>): Ride {
    const ride = new Ride();
    ride.id = row.id?.toString?.() ?? row.id ?? ride.id;
    ride.riderId =
      row.rider_id?.toString?.() ?? row.riderId?.toString?.() ?? ride.riderId;
    ride.driverId =
      row.driver_id?.toString?.() ?? row.driverId?.toString?.() ?? null;

    if (row.pickup_lon !== undefined && row.pickup_lon !== null) {
      ride.pickupLongitude = Number(row.pickup_lon);
    } else if (
      row.pickupLongitude !== undefined &&
      row.pickupLongitude !== null
    ) {
      ride.pickupLongitude = Number(row.pickupLongitude);
    }
    if (row.pickup_lat !== undefined && row.pickup_lat !== null) {
      ride.pickupLatitude = Number(row.pickup_lat);
    } else if (
      row.pickupLatitude !== undefined &&
      row.pickupLatitude !== null
    ) {
      ride.pickupLatitude = Number(row.pickupLatitude);
    }
    if (row.dropoff_lon !== undefined && row.dropoff_lon !== null) {
      ride.dropoffLongitude = Number(row.dropoff_lon);
    } else if (
      row.dropoffLongitude !== undefined &&
      row.dropoffLongitude !== null
    ) {
      ride.dropoffLongitude = Number(row.dropoffLongitude);
    }
    if (row.dropoff_lat !== undefined && row.dropoff_lat !== null) {
      ride.dropoffLatitude = Number(row.dropoff_lat);
    } else if (
      row.dropoffLatitude !== undefined &&
      row.dropoffLatitude !== null
    ) {
      ride.dropoffLatitude = Number(row.dropoffLatitude);
    }

    const normalizedStatus = this.normalizeStatus(row.status ?? ride.status);
    ride.status = normalizedStatus ?? ride.status ?? ERideStatus.REQUESTED;
    ride.fareEstimated =
      row.fare_estimated ?? row.fareEstimated ?? ride.fareEstimated;
    ride.fareFinal = row.fare_final ?? row.fareFinal ?? ride.fareFinal;
    ride.discountPercent =
      row.discount_percent !== undefined && row.discount_percent !== null
        ? Number(row.discount_percent)
        : row.discountPercent !== undefined && row.discountPercent !== null
          ? Number(row.discountPercent)
          : null;
    ride.discountAmount =
      row.discount_amount ?? row.discountAmount ?? ride.discountAmount;
    ride.appFeeAmount =
      row.app_fee_amount ?? row.appFeeAmount ?? ride.appFeeAmount;
    ride.distanceEstimatedKm =
      row.distance_estimated_km !== undefined &&
      row.distance_estimated_km !== null
        ? Number(row.distance_estimated_km)
        : row.distanceEstimatedKm !== undefined &&
            row.distanceEstimatedKm !== null
          ? Number(row.distanceEstimatedKm)
          : null;
    ride.durationEstimatedSeconds =
      row.duration_estimated_seconds !== undefined &&
      row.duration_estimated_seconds !== null
        ? Number(row.duration_estimated_seconds)
        : row.durationEstimatedSeconds !== undefined &&
            row.durationEstimatedSeconds !== null
          ? Number(row.durationEstimatedSeconds)
          : null;
    ride.distanceActualKm =
      row.distance_actual_km !== undefined && row.distance_actual_km !== null
        ? Number(row.distance_actual_km)
        : row.distanceActualKm !== undefined && row.distanceActualKm !== null
          ? Number(row.distanceActualKm)
          : null;
    ride.paymentUrl = row.payment_url ?? row.paymentUrl ?? null;
    ride.paymentStatus = row.payment_status ?? row.paymentStatus ?? null;
    ride.note = row.note ?? ride.note ?? null;
    ride.cancelReason = row.cancel_reason ?? row.cancelReason ?? null;
    ride.createdAt = row.created_at
      ? new Date(row.created_at)
      : row.createdAt
        ? new Date(row.createdAt)
        : ride.createdAt;
    ride.updatedAt = row.updated_at
      ? new Date(row.updated_at)
      : row.updatedAt
        ? new Date(row.updatedAt)
        : ride.updatedAt;
    ride.deletedAt = row.deleted_at
      ? new Date(row.deleted_at)
      : row.deletedAt
        ? new Date(row.deletedAt)
        : null;
    return ride;
  }

  private mergeRideData(current: Ride, changes: Ride): Ride {
    const merged = new Ride();
    Object.assign(merged, current);

    (Object.keys(changes) as Array<keyof Ride>).forEach((key) => {
      const value = changes[key];
      if (value !== undefined) {
        (merged as unknown as Record<string, unknown>)[key as string] =
          value as unknown;
      }
    });

    return merged;
  }

  private normalizeStatus(status: unknown): ERideStatus | null {
    const normalized = status?.toString?.().toLowerCase?.();
    const allowed = new Set(Object.values(ERideStatus));
    if (normalized && allowed.has(normalized as ERideStatus)) {
      return normalized as ERideStatus;
    }
    return null;
  }
}
