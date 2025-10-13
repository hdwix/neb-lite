import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { EClientStatus } from '../../../app/enums/client-status.enum';
import { EClientType } from '../../../app/enums/client-type.enum';

@Entity({ name: 'nebengjek_client', synchronize: true })
export class NebengjekClient {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'client_name', nullable: true })
  clientName: string;

  @Column({ name: 'phone_number', unique: true })
  phoneNumber: string;

  @Column({ type: 'enum', enum: EClientType, default: EClientType.CUSTOMER })
  role: EClientType;

  @Column({ type: 'enum', enum: EClientStatus, default: EClientStatus.ACTIVE })
  status: EClientStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt: Date;

  @DeleteDateColumn({
    name: 'deleted_at',
    type: 'timestamp',
    nullable: true,
  })
  deletedAt?: Date;
}
