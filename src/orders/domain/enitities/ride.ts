import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';
import { ERideStatus } from '../../../app/enums/ride-status.enum';

@Entity('ride')
@Index('ix_ride_rider_id', ['riderId'])
@Index('ix_ride_driver_id', ['driverId'])
@Index('ix_ride_status', ['status'])
export class Ride {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Column({ name: 'rider_msisdn', type: 'varchar', length: 32 })
  riderMsisdn!: string;

  @Column({ name: 'driver_msisdn', type: 'varchar', length: 32 })
  driverMsisdn?: string;

  @Column({ name: 'pickup_lat', type: 'double precision' })
  pickupLat!: number;

  @Column({ name: 'pickup_long', type: 'double precision' })
  pickupLong!: number;

  @Column({ name: 'dropoff_lat', type: 'double precision' })
  dropoffLat!: number;

  @Column({ name: 'dropoff_long', type: 'double precision' })
  dropoffLng!: number;

  @Column({ type: 'varchar', length: 32, default: ERideStatus.NYSTART })
  status!: ERideStatus;

  @Column({
    name: 'fare_estimated',
    type: 'numeric',
    precision: 12,
    scale: 2,
    nullable: true,
  })
  fareEstimated?: string;

  @Column({
    name: 'fare_final',
    type: 'numeric',
    precision: 12,
    scale: 2,
    nullable: true,
  })
  fareFinal?: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt?: Date | null;
}
