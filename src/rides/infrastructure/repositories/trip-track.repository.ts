import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { TripTrack } from '../../domain/entities/trip-track.entity';
import {
  TripSummaryRepository,
  TripSummaryUpsert,
} from './trip-summary.repository';

@Injectable()
export class TripTrackRepository {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly tripSummaryRepository: TripSummaryRepository,
  ) {}

  create(data: Partial<TripTrack>): TripTrack {
    return { ...data } as TripTrack;
  }

  async persistFlush(
    entries: TripTrack[],
    summaries: TripSummaryUpsert[],
  ): Promise<void> {
    if (!entries.length && !summaries.length) {
      return;
    }

    const queryRunner = this.dataSource.createQueryRunner();

    try {
      await queryRunner.connect();
      await queryRunner.startTransaction();

      if (entries.length) {
        const { sql, parameters } = this.buildInsertManyStatement(entries);
        await queryRunner.manager.query(sql, parameters);
      }

      if (summaries.length) {
        await this.tripSummaryRepository.upsertSummaries(
          summaries,
          queryRunner.manager,
        );
      }

      await queryRunner.commitTransaction();
    } catch (error) {
      if (queryRunner.isTransactionActive) {
        await queryRunner.rollbackTransaction();
      }

      throw error;
    } finally {
      if (!queryRunner.isReleased) {
        await queryRunner.release();
      }
    }
  }

  private buildInsertManyStatement(entries: TripTrack[]): {
    sql: string;
    parameters: unknown[];
  } {
    const valueColumns = 8;
    const values: string[] = [];
    const parameters: unknown[] = [];

    entries.forEach((entry, index) => {
      const offset = index * valueColumns;
      values.push(
        `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8})`,
      );

      parameters.push(
        entry.rideId,
        entry.clientId,
        entry.clientRole,
        entry.longitude,
        entry.latitude,
        entry.distanceDeltaMeters,
        entry.totalDistanceMeters ?? null,
        entry.recordedAt,
      );
    });

    const sql = `
      INSERT INTO trip_track (
        ride_id,
        client_id,
        client_role,
        longitude,
        latitude,
        distance_delta_meters,
        total_distance_meters,
        recorded_at
      ) VALUES ${values.join(', ')}
    `;

    return { sql, parameters };
  }
}
