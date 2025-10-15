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

@Entity('ride_status_history')
@Index('ix_rsh_ride_id', ['rideId'])
export class RideStatusHistory {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Column({ name: 'ride_id', type: 'bigint' })
  rideId!: string;

  @Column({ name: 'from_status', type: 'varchar', length: 32 })
  fromStatus!: ERideStatus;

  @Column({ name: 'to_status', type: 'varchar', length: 32 })
  toStatus!: ERideStatus;

  @Column({ type: 'varchar', length: 255, nullable: true })
  reason?: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt?: Date | null;
}
