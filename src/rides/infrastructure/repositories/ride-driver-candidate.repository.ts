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
  ): Promise<RideDriverCandidate> {
    return candidate.id
      ? this.updateCandidate(candidate)
      : this.insertCandidate(candidate);
  }

  async saveMany(
    candidates: RideDriverCandidate[],
  ): Promise<RideDriverCandidate[]> {
    if (!candidates.length) {
      return [];
    }

    const results: RideDriverCandidate[] = [];
    for (const candidate of candidates) {
      results.push(await this.save(candidate));
    }
    return results;
  }

  async findByRideId(rideId: string): Promise<RideDriverCandidate[]> {
    const rows = await this.dataSource.query(
      `
        SELECT
          id,
          ride_id,
          driver_id,
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
          driver_id,
          status,
          distance_meters,
          reason,
          responded_at,
          created_at,
          updated_at
        FROM ride_driver_candidates
        WHERE ride_id = $1::bigint
          AND driver_id = $2
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
  ): Promise<RideDriverCandidate> {
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
          $2,
          $3,
          $4,
          $5,
          $6
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
        candidate.rideId,
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
  ): Promise<RideDriverCandidate> {
    if (!candidate.id) {
      throw new Error('Candidate id is required for updates');
    }

    const rows = await this.dataSource.query(
      `
        UPDATE ride_driver_candidates
        SET
          status = $2,
          reason = $3,
          distance_meters = $4,
          responded_at = $5,
          updated_at = NOW()
        WHERE id = $1::bigint
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
        candidate.id,
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
    candidate.driverId = row.driver_id ?? candidate.driverId;
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
}
