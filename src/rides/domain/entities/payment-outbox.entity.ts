import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { PaymentOutboxStatus } from '../constants/payment.constants';

@Entity('ride_payment_outbox')
export class PaymentOutbox {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'ride_id', type: 'bigint' })
  rideId!: string;

  @Column({ name: 'payment_detail_id', type: 'bigint' })
  paymentDetailId!: string;

  @Column({ name: 'order_id', type: 'varchar', length: 128 })
  orderId!: string;

  @Column({ name: 'status', type: 'varchar', length: 32 })
  status!: PaymentOutboxStatus;

  @Column({ name: 'attempts', type: 'int', default: 0 })
  attempts!: number;

  @Column({ name: 'job_id', type: 'varchar', length: 255, nullable: true })
  jobId?: string | null;

  @Column({ name: 'request_payload', type: 'jsonb' })
  requestPayload!: Record<string, unknown>;

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError?: string | null;

  @Column({ name: 'last_attempted_at', type: 'timestamptz', nullable: true })
  lastAttemptedAt?: Date | null;

  @Column({ name: 'processed_at', type: 'timestamptz', nullable: true })
  processedAt?: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
