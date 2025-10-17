import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ERideStatus } from '../../../app/enums/ride-status.enum';
import { Ride } from './ride.entity';

@Entity('ride_status_history')
export class RideStatusHistory {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'ride_id', type: 'uuid' })
  rideId!: string;

  @ManyToOne(() => Ride, (ride) => ride.statusHistory, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'ride_id' })
  ride!: Ride;

  @Column({ name: 'from_status', type: 'varchar', length: 32, nullable: true })
  fromStatus?: ERideStatus | null;

  @Column({ name: 'to_status', type: 'varchar', length: 32 })
  toStatus!: ERideStatus;

  @Column({ name: 'context', type: 'varchar', length: 255, nullable: true })
  context?: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
