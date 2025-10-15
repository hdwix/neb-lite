import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';
import { EPaymentStatus } from '../../../app/enums/payment-status.enum';

@Entity('payment_intent')
@Index('ix_pi_ride_id', ['rideId'])
@Index('ix_pi_status', ['status'])
export class Payment {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Column({ name: 'ride_id', type: 'bigint' })
  rideId!: string;

  @Column({ type: 'numeric', precision: 12, scale: 2 })
  amount!: string;

  @Column({ type: 'varchar', length: 24, default: 'created' })
  status!: EPaymentStatus;

  @Column({ name: 'provider', type: 'varchar', length: 32, nullable: true })
  provider?: string;

  @Column({
    name: 'provider_ref',
    type: 'varchar',
    length: 128,
    nullable: true,
  })
  providerRef?: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt?: Date | null;
}
