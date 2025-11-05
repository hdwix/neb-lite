import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type TripTrackParticipantRole = 'driver' | 'rider';

@Entity('trip_track')
@Index('ix_trip_track_ride_id', ['rideId'])
export class TripTrack {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Column({ name: 'ride_id', type: 'varchar', length: 64 })
  rideId!: string;

  @Column({
    name: 'participant_id',
    type: 'varchar',
    length: 64,
  })
  participantId!: string;

  @Column({
    name: 'participant_role',
    type: 'varchar',
    length: 16,
  })
  participantRole!: TripTrackParticipantRole;

  @Column({ name: 'longitude', type: 'double precision' })
  longitude!: number;

  @Column({ name: 'latitude', type: 'double precision' })
  latitude!: number;

  @Column({
    name: 'distance_delta_meters',
    type: 'double precision',
    default: 0,
  })
  distanceDeltaMeters!: number;

  @Column({
    name: 'total_distance_meters',
    type: 'double precision',
    nullable: true,
  })
  totalDistanceMeters?: number | null;

  @Column({ name: 'recorded_at', type: 'timestamptz' })
  recordedAt!: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

export type { TripTrackParticipantRole };
