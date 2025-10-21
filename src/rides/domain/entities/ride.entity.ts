import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ERideStatus } from '../../../app/enums/ride-status.enum';
import { RideStatusHistory } from './ride-status-history.entity';

@Entity('rides')
@Index('ix_rides_rider_id', ['riderId'])
@Index('ix_rides_driver_id', ['driverId'])
@Index('ix_rides_status', ['status'])
export class Ride {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Column({ name: 'rider_id', type: 'varchar', length: 64 })
  riderId!: string;

  @Column({ name: 'driver_id', type: 'varchar', length: 64, nullable: true })
  driverId?: string | null;

  @Column({ name: 'pickup_lon', type: 'double precision' })
  pickupLon!: number;

  @Column({ name: 'pickup_lat', type: 'double precision' })
  pickupLat!: number;

  @Column({ name: 'dropoff_lon', type: 'double precision' })
  dropoffLon!: number;

  @Column({ name: 'dropoff_lat', type: 'double precision' })
  dropoffLat!: number;

  @Column({
    name: 'status',
    type: 'varchar',
    length: 32,
    default: ERideStatus.REQUESTED,
  })
  status!: ERideStatus;

  @Column({
    name: 'fare_estimated',
    type: 'numeric',
    precision: 12,
    scale: 2,
    nullable: true,
  })
  fareEstimated?: string | null;

  @Column({
    name: 'fare_final',
    type: 'numeric',
    precision: 12,
    scale: 2,
    nullable: true,
  })
  fareFinal?: string | null;

  @Column({
    name: 'distance_estimated_km',
    type: 'double precision',
    nullable: true,
  })
  distanceEstimatedKm?: number | null;

  @Column({
    name: 'duration_estimated_seconds',
    type: 'integer',
    nullable: true,
  })
  durationEstimatedSeconds?: number | null;

  @Column({ name: 'note', type: 'varchar', length: 255, nullable: true })
  note?: string | null;

  @Column({
    name: 'cancel_reason',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  cancelReason?: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt?: Date | null;

  @OneToMany(() => RideStatusHistory, (history) => history.ride)
  statusHistory?: RideStatusHistory[];
}
