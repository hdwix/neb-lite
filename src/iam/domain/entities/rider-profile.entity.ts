import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';
import { EClientType } from '../../../app/enums/client-type.enum';
import { EClientStatus } from '../../../app/enums/client-status.enum';

@Entity('rider_profile')
@Index('ux_rider_phone_e164', ['msisdn'], { unique: true })
export class RiderProfile {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Column({ name: 'msisdn', type: 'varchar', length: 32 })
  msisdn!: string;

  @Column({ type: 'varchar', length: 70, nullable: true })
  name?: string;

  @Column({ type: 'enum', enum: EClientType, default: EClientType.RIDER })
  role!: EClientType;

  @Column({ type: 'varchar', length: 10, default: EClientStatus.ACTIVE })
  status!: EClientStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt?: Date | null;
}
