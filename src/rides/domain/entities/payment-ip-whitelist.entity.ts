import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('ip_payment_whitelist')
@Index('ux_ip_payment_whitelist_address', ['ipAddress'], { unique: true })
export class PaymentIpWhitelist {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Column({ name: 'ip_address', type: 'varchar', length: 64, unique: true })
  ipAddress!: string;

  @Column({ name: 'description', type: 'varchar', length: 255, nullable: true })
  description?: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
