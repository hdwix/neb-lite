import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { RideDriverCandidate } from '../../domain/entities/ride-driver-candidate.entity';

@Injectable()
export class RideDriverCandidateRepository {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  create(data: Partial<RideDriverCandidate>): RideDriverCandidate {
    return Object.assign(new RideDriverCandidate(), data);
  }

  async save(
    candidate: RideDriverCandidate,
    rideId?: string,
  ): Promise<RideDriverCandidate> {
    return candidate.id
      ? this.updateCandidate(candidate, rideId)
      : this.insertCandidate(candidate, rideId);
  }

  async saveMany(
    candidates: RideDriverCandidate[],
    rideId?: string,
  ): Promise<RideDriverCandidate[]> {
    if (!candidates.length) {
      return [];
    }

    const results: RideDriverCandidate[] = [];
    for (const candidate of candidates) {
      results.push(await this.save(candidate, rideId));
    }
    return results;
  }

  async findByRideId(rideId: string): Promise<RideDriverCandidate[]> {
    const rows = await this.dataSource.query(
      `
        SELECT
          id,
          ride_id,
          driver_id::text AS driver_id,
          status,
          distance_meters,
          reason,
          responded_at,
          created_at,
          updated_at
        FROM ride_driver_candidates
        WHERE ride_id = $1::bigint
        ORDER BY created_at ASC;
      `,
      [rideId],
    );

    return (rows ?? []).map((row: Record<string, any>) =>
      this.mapRowToEntity(row),
    );
  }

  async findByRideAndDriver(
    rideId: string,
    driverId: string,
  ): Promise<RideDriverCandidate | null> {
    const rows = await this.dataSource.query(
      `
        SELECT
          id,
          ride_id,
          driver_id::text AS driver_id,
          status,
          distance_meters,
          reason,
          responded_at,
          created_at,
          updated_at
        FROM ride_driver_candidates
        WHERE ride_id = $1::bigint
          AND driver_id = $2::bigint
        LIMIT 1;
      `,
      [rideId, driverId],
    );

    if (!rows?.length) {
      return null;
    }

    return this.mapRowToEntity(rows[0]);
  }

  private async insertCandidate(
    candidate: RideDriverCandidate,
    rideId?: string,
  ): Promise<RideDriverCandidate> {
    const resolvedRideId = this.getRideId(candidate, rideId);
    const rows = await this.dataSource.query(
      `
        INSERT INTO ride_driver_candidates (
          ride_id,
          driver_id,
          status,
          distance_meters,
          reason,
          responded_at
        ) VALUES (
          $1::bigint,
          $2::bigint,
          $3,
          $4,
          $5,
          $6
        )
        RETURNING
          id,
          ride_id,
          driver_id::text AS driver_id,
          status,
          distance_meters,
          reason,
          responded_at,
          created_at,
          updated_at;
      `,
      [
        resolvedRideId,
        candidate.driverId,
        candidate.status,
        candidate.distanceMeters ?? null,
        candidate.reason ?? null,
        candidate.respondedAt ?? null,
      ],
    );

    if (!rows?.length) {
      throw new Error('Failed to create ride driver candidate');
    }

    return this.mapRowToEntity(rows[0]);
  }

  private async updateCandidate(
    candidate: RideDriverCandidate,
    rideId?: string,
  ): Promise<RideDriverCandidate> {
    if (!candidate.id) {
      throw new Error('Candidate id is required for updates');
    }

    const resolvedRideId = this.getRideId(candidate, rideId);
    const rows = await this.dataSource.query(
      `
        UPDATE ride_driver_candidates
        SET
          ride_id = $2::bigint,
          status = $3,
          reason = $4,
          distance_meters = $5,
          responded_at = $6,
          updated_at = NOW()
        WHERE id = $1::bigint
        RETURNING
          id,
          ride_id,
          driver_id::text AS driver_id,
          status,
          distance_meters,
          reason,
          responded_at,
          created_at,
          updated_at;
      `,
      [
        candidate.id,
        resolvedRideId,
        candidate.status,
        candidate.reason ?? null,
        candidate.distanceMeters ?? null,
        candidate.respondedAt ?? null,
      ],
    );

    if (!rows?.length) {
      throw new Error('Ride driver candidate not found while updating');
    }

    return this.mapRowToEntity(rows[0]);
  }

  private mapRowToEntity(row: Record<string, any>): RideDriverCandidate {
    const candidate = new RideDriverCandidate();
    candidate.id = row.id?.toString?.() ?? row.id ?? candidate.id;
    candidate.rideId = row.ride_id?.toString?.() ?? row.ride_id ?? candidate.rideId;
    candidate.driverId =
      row.driver_id?.toString?.() ?? row.driverId?.toString?.() ?? candidate.driverId;
    candidate.status = row.status ?? candidate.status;
    candidate.distanceMeters =
      row.distance_meters !== undefined && row.distance_meters !== null
        ? Number(row.distance_meters)
        : null;
    candidate.reason = row.reason ?? null;
    candidate.respondedAt = row.responded_at
      ? new Date(row.responded_at)
      : candidate.respondedAt ?? null;
    candidate.createdAt = row.created_at
      ? new Date(row.created_at)
      : candidate.createdAt;
    candidate.updatedAt = row.updated_at
      ? new Date(row.updated_at)
      : candidate.updatedAt;
    return candidate;
  }

  private getRideId(
    candidate: RideDriverCandidate,
    providedRideId?: string,
  ): string {
    if (providedRideId) {
      return providedRideId;
    }

    if (candidate.rideId) {
      return candidate.rideId;
    }

    throw new Error('Ride id is required for ride driver candidates');
  }
}
