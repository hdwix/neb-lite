import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Ride } from './ride.entity';

@Entity('ride_payment_details')
@Index('ux_ride_payment_details_ride_id', ['rideId'], { unique: true })
export class RidePaymentDetail {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Column({ name: 'ride_id', type: 'bigint' })
  rideId!: string;

  @ManyToOne(() => Ride)
  @JoinColumn({ name: 'ride_id' })
  ride?: Ride;

  @Column({ name: 'provider', type: 'varchar', length: 64 })
  provider!: string;

  @Column({ name: 'status', type: 'varchar', length: 32 })
  status!: string;

  @Column({ name: 'token', type: 'varchar', length: 255, nullable: true })
  token?: string | null;

  @Column({ name: 'redirect_url', type: 'varchar', length: 255, nullable: true })
  redirectUrl?: string | null;

  @Column({ name: 'order_id', type: 'varchar', length: 128, nullable: true })
  orderId?: string | null;

  @Column({
    name: 'provider_transaction_id',
    type: 'varchar',
    length: 128,
    nullable: true,
  })
  providerTransactionId?: string | null;

  @Column({ name: 'request_payload', type: 'jsonb', nullable: true })
  requestPayload?: Record<string, unknown> | null;

  @Column({ name: 'response_payload', type: 'jsonb', nullable: true })
  responsePayload?: Record<string, unknown> | null;

  @Column({ name: 'notification_payload', type: 'jsonb', nullable: true })
  notificationPayload?: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
