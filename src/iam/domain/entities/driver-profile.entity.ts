import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';
import { EClientStatus } from '../constants/client-status.enum';
import { EClientType } from '../../../app/enums/client-type.enum';

@Entity('driver_profile')
@Index('ix_driver_profile_msisdn_status', ['msisdn', 'status'])
export class DriverProfile {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Column({ name: 'msisdn', type: 'varchar', length: 32 })
  msisdn!: string;

  @Column({ name: 'name', type: 'text', nullable: true })
  name?: string;

  @Column({
    name: 'driver_license_no',
    type: 'text',
    nullable: true,
  })
  driverLicenseNo?: string;

  @Column({ name: 'license_expiry', type: 'date', nullable: true })
  licenseExpiry?: string;

  @Column({
    name: 'status',
    type: 'enum',
    enum: EClientStatus,
    enumName: 'client_status',
    default: EClientStatus.ACTIVE,
  })
  status!: EClientStatus;

  @Column({ type: 'enum', enum: EClientType, default: EClientType.DRIVER })
  role!: EClientType;

  @Column({
    name: 'vehicle_license_plate',
    type: 'text',
    nullable: true,
  })
  vehicleLicensePlate?: string;

  @Column({
    name: 'vehicle_brand',
    type: 'varchar',
    length: 30,
    nullable: true,
  })
  vehicleBrand?: string;

  @Column({ name: 'vehicle_type', type: 'varchar', length: 64, nullable: true })
  vehicleType?: string;

  @Column({
    name: 'vehicle_color',
    type: 'varchar',
    length: 30,
    nullable: true,
  })
  vehicleColor?: string;

  @Column({ name: 'vehicle_year', type: 'int', nullable: true })
  vehicleYear?: number;

  @Column({ name: 'vehicle_capacity', type: 'int', nullable: true })
  vehicleCapacity?: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt?: Date | null;
}
