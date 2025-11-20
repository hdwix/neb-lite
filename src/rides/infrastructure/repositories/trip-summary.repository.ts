import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { TripSummaryLocationPayload } from '../../domain/entities/trip-summary.entity';
import { EClientType } from '../../../app/enums/client-type.enum';

export interface TripSummaryUpsert {
  rideId: string;
  clientId: string;
  clientRole: EClientType;
  locationPayload: TripSummaryLocationPayload | null;
  totalDistanceMeters: number | null;
}

@Injectable()
export class TripSummaryRepository {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  async upsertSummaries(
    summaries: TripSummaryUpsert[],
    manager?: EntityManager,
  ): Promise<void> {
    if (!summaries.length) {
      return;
    }

    const valueColumns = 5;
    const values: string[] = [];
    const parameters: unknown[] = [];

    summaries.forEach((summary, index) => {
      const offset = index * valueColumns;
      values.push(
        `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}::jsonb, $${offset + 5})`,
      );

      parameters.push(
        summary.rideId,
        summary.clientId,
        summary.clientRole,
        summary.locationPayload
          ? JSON.stringify(summary.locationPayload)
          : null,
        summary.totalDistanceMeters ?? null,
      );
    });

    const sql = `
      INSERT INTO trip_summary (
        ride_id,
        client_id,
        client_role,
        location_payload,
        total_distance_meters
      ) VALUES ${values.join(', ')}
      ON CONFLICT (ride_id, client_role)
      DO UPDATE SET
        client_id = EXCLUDED.client_id,
        location_payload = EXCLUDED.location_payload,
        total_distance_meters = EXCLUDED.total_distance_meters,
        updated_at = NOW()
    `;

    if (manager) {
      await manager.query(sql, parameters);
    } else {
      await this.dataSource.query(sql, parameters);
    }
  }
}
