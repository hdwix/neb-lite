import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { EClientType } from '../../../app/enums/client-type.enum';

@Entity('trip_track')
@Index('ix_trip_track_ride_id', ['rideId'])
export class TripTrack {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Column({ name: 'ride_id', type: 'bigint' })
  rideId!: string;

  @Column({
    name: 'client_id',
    type: 'bigint',
  })
  clientId!: string;

  @Column({
    name: 'client_role',
    type: 'enum',
    enum: EClientType,
  })
  clientRole!: EClientType;

  @Column({ name: 'longitude', type: 'double precision' })
  longitude!: number;

  @Column({ name: 'latitude', type: 'double precision' })
  latitude!: number;

  @Column({
    name: 'distance_delta_meters',
    type: 'double precision',
    default: 0,
  })
  distanceDeltaMeters!: number;

  @Column({
    name: 'total_distance_meters',
    type: 'double precision',
    nullable: true,
  })
  totalDistanceMeters?: number | null;

  @Column({ name: 'recorded_at', type: 'timestamptz' })
  recordedAt!: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

