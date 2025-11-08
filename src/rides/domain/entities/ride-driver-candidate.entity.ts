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
import { ERideDriverCandidateStatus } from '../constants/ride-driver-candidate-status.enum';

@Entity('ride_driver_candidates')
@Index('ix_ride_driver_candidates_ride_id', ['rideId'])
@Index('ix_ride_driver_candidates_driver_id', ['driverId'])
export class RideDriverCandidate {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Column({ name: 'ride_id', type: 'bigint' })
  rideId!: string;

  @ManyToOne(() => Ride, (ride) => ride.candidates, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'ride_id' })
  ride!: Ride;

  @Column({ name: 'driver_id', type: 'varchar', length: 64 })
  driverId!: string;

  @Column({
    name: 'status',
    type: 'varchar',
    length: 32,
    default: ERideDriverCandidateStatus.INVITED,
  })
  status!: ERideDriverCandidateStatus;

  @Column({ name: 'distance_meters', type: 'integer', nullable: true })
  distanceMeters?: number | null;

  @Column({ name: 'reason', type: 'varchar', length: 255, nullable: true })
  reason?: string | null;

  @Column({ name: 'responded_at', type: 'timestamptz', nullable: true })
  respondedAt?: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
