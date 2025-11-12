import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { EClientType } from '../../../app/enums/client-type.enum';

export interface TripSummaryLocationPayload {
  longitude: number;
  latitude: number;
  accuracyMeters?: number | null;
  recordedAt: string;
}

@Entity('trip_summary')
@Index('uq_trip_summary_ride_role', ['rideId', 'clientRole'], { unique: true })
export class TripSummary {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Column({ name: 'ride_id', type: 'varchar', length: 64 })
  rideId!: string;

  @Column({ name: 'client_id', type: 'varchar', length: 64 })
  clientId!: string;

  @Column({
    name: 'client_role',
    type: 'enum',
    enum: EClientType,
  })
  clientRole!: EClientType;

  @Column({
    name: 'location_payload',
    type: 'jsonb',
    nullable: true,
  })
  locationPayload?: TripSummaryLocationPayload | null;

  @Column({
    name: 'total_distance_meters',
    type: 'double precision',
    nullable: true,
  })
  totalDistanceMeters?: number | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
