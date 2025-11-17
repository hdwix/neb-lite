import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { RideStatusHistory } from '../../domain/entities/ride-status-history.entity';

@Injectable()
export class RideStatusHistoryRepository {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  create(data: Partial<RideStatusHistory>): RideStatusHistory {
    return Object.assign(new RideStatusHistory(), data);
  }

  async save(entity: RideStatusHistory): Promise<RideStatusHistory> {
    const rows = await this.dataSource.query(
      `
        INSERT INTO ride_status_history (
          ride_id,
          from_status,
          to_status,
          context
        ) VALUES (
          $1,
          $2,
          $3,
          $4
        )
        RETURNING
          id,
          ride_id,
          from_status,
          to_status,
          context,
          created_at;
      `,
      [
        entity.rideId,
        entity.fromStatus ?? null,
        entity.toStatus,
        entity.context ?? null,
      ],
    );

    if (!rows?.length) {
      throw new Error('Failed to persist ride status history');
    }

    return this.mapRowToEntity(rows[0]);
  }

  private mapRowToEntity(row: Record<string, any>): RideStatusHistory {
    const history = new RideStatusHistory();
    history.id = row.id?.toString?.() ?? row.id ?? history.id;
    history.rideId = row.ride_id?.toString?.() ?? row.ride_id ?? history.rideId;
    history.fromStatus = row.from_status ?? null;
    history.toStatus = row.to_status ?? history.toStatus;
    history.context = row.context ?? null;
    history.createdAt = row.created_at
      ? new Date(row.created_at)
      : history.createdAt;
    return history;
  }
}
