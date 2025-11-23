import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ERideStatus } from '../constants/ride-status.enum';

@Entity('ride_status_history')
@Index('ix_ride_status_history_ride', ['rideId'])
export class RideStatusHistory {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Column({ name: 'ride_id', type: 'bigint' })
  rideId!: string;

  @Column({
    name: 'from_status',
    type: 'enum',
    enum: ERideStatus,
    enumName: 'ride_status',
    nullable: true,
  })
  fromStatus?: ERideStatus | null;

  @Column({ name: 'to_status', type: 'enum', enum: ERideStatus, enumName: 'ride_status' })
  toStatus!: ERideStatus;

  @Column({ name: 'context', type: 'varchar', length: 255, nullable: true })
  context?: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
