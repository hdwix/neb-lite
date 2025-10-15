import { Injectable, Logger } from '@nestjs/common';
import { Repository, DataSource } from 'typeorm';
import { InjectDataSource } from '@nestjs/typeorm';
import { RiderProfile } from '../../domain/entities/rider-profile.entity';

@Injectable()
export class RiderProfileRepository extends Repository<RiderProfile> {
  private readonly logger = new Logger(RiderProfileRepository.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {
    super(RiderProfile, dataSource.createEntityManager());
  }

  async upsertRiderByPhone(phone: string) {
    this.logger.log(`process upsert for phone number : ${phone}`);
    try {
      const upsertClientQuery = `
      INSERT INTO rider_profile (msisdn)
      VALUES ($1)
      ON CONFLICT (msisdn) DO NOTHING
    `;
      await this.dataSource.query(upsertClientQuery, [phone]);
    } catch (error) {
      this.logger.error(error.message);
    }
  }

  async findRiderByPhone(phone: string): Promise<any> {
    const findClientQuery = `
      SELECT id, msisdn, role FROM rider_profile
      WHERE msisdn=$1 AND status='ACTIVE'
    `;
    return await this.dataSource.query(findClientQuery, [phone]);
  }

  async findRiderbyId(id: number) {
    const findClientByIdQuery = `
      SELECT id, msisdn, role FROM rider_profile
      WHERE id=$1 AND status='ACTIVE'
    `;
    return await this.dataSource.query(findClientByIdQuery, [id]);
  }
}
