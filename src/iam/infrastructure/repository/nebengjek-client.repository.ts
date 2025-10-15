import { Injectable, Logger } from '@nestjs/common';
import { Repository, DataSource } from 'typeorm';
import { InjectDataSource } from '@nestjs/typeorm';
import { NebengjekClient } from '../../domain/entities/nebengjek-client.entity';

@Injectable()
export class NebengjekClientRepository extends Repository<NebengjekClient> {
  private readonly logger = new Logger(NebengjekClientRepository.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {
    super(NebengjekClient, dataSource.createEntityManager());
  }

  async upsertUserByPhone(phone: string) {
    this.logger.log(`process upsert for phone number : ${phone}`);
    try {
      const upsertClientQuery = `
      INSERT INTO nebengjek_client (phone_number)
      VALUES ($1)
      ON CONFLICT (phone_number) DO NOTHING
    `;
      await this.dataSource.query(upsertClientQuery, [phone]);
    } catch (error) {
      this.logger.error(error.message);
    }
  }

  async findUserByPhone(phone: string): Promise<any> {
    const findClientQuery = `
      SELECT id, phone_number, role FROM nebengjek_client
      WHERE phone_number=$1 AND status='ACTIVE'
    `;
    return await this.dataSource.query(findClientQuery, [phone]);
  }

  async findUserbyId(id: number) {
    const findClientByIdQuery = `
      SELECT id, phone_number, role FROM nebengjek_client
      WHERE id=$1 AND status='ACTIVE'
    `;
    return await this.dataSource.query(findClientByIdQuery, [id]);
  }
}
