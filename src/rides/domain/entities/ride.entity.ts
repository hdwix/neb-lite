import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ERideStatus } from '../constants/ride-status.enum';
import { ERidePaymentStatus } from '../constants/ride-payment-status.enum';

@Entity('rides')
@Index('ix_rides_rider_id', ['riderId'])
@Index('ix_rides_driver_id', ['driverId'])
@Index('ix_rides_status', ['status'])
export class Ride {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Column({ name: 'rider_id', type: 'bigint' })
  riderId!: string;

  @Column({ name: 'driver_id', type: 'bigint', nullable: true })
  driverId?: string | null;

  @Column({ name: 'pickup_lon', type: 'double precision' })
  pickupLongitude!: number;

  @Column({ name: 'pickup_lat', type: 'double precision' })
  pickupLatitude!: number;

  @Column({ name: 'dropoff_lon', type: 'double precision' })
  dropoffLongitude!: number;

  @Column({ name: 'dropoff_lat', type: 'double precision' })
  dropoffLatitude!: number;

  @Column({
    name: 'status',
    type: 'enum',
    enum: ERideStatus,
    enumName: 'ride_status',
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
    name: 'discount_percent',
    type: 'double precision',
    nullable: true,
  })
  discountPercent?: number | null;

  @Column({
    name: 'discount_amount',
    type: 'numeric',
    precision: 12,
    scale: 2,
    nullable: true,
  })
  discountAmount?: string | null;

  @Column({
    name: 'app_fee_amount',
    type: 'numeric',
    precision: 12,
    scale: 2,
    nullable: true,
  })
  appFeeAmount?: string | null;

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

  @Column({
    name: 'distance_actual_km',
    type: 'double precision',
    nullable: true,
  })
  distanceActualKm?: number | null;

  @Column({
    name: 'payment_url',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  paymentUrl?: string | null;

  @Column({
    name: 'payment_status',
    type: 'varchar',
    length: 32,
    nullable: true,
  })
  paymentStatus?: ERidePaymentStatus | null;

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
}
