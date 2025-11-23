import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ERideDriverCandidateStatus } from '../constants/ride-driver-candidate-status.enum';

@Entity('ride_driver_candidates')
@Index('ix_ride_driver_candidates_ride_driver', ['rideId', 'driverId'])
@Index('ix_ride_driver_candidates_ride_created', ['rideId', 'createdAt'])
export class RideDriverCandidate {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Column({ name: 'ride_id', type: 'bigint' })
  rideId!: string;

  @Column({ name: 'driver_id', type: 'bigint' })
  driverId!: string;

  @Column({
    name: 'status',
    type: 'enum',
    enum: ERideDriverCandidateStatus,
    enumName: 'ride_driver_candidate_status',
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
