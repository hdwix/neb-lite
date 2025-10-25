import { Injectable, Logger } from '@nestjs/common';
import { Repository, DataSource, EntityManager } from 'typeorm';
import { InjectDataSource } from '@nestjs/typeorm';
import { DriverProfile } from '../../domain/entities/driver-profile.entity';

@Injectable()
export class DriverProfileRepository extends Repository<DriverProfile> {
  private readonly logger = new Logger(DriverProfileRepository.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {
    super(DriverProfile, dataSource.createEntityManager());
  }
  private getExecutor(manager?: EntityManager) {
    return manager ?? this.dataSource;
  }

  async createDriverProfile(
    msisdn: string,
    driverLicenseNo: string | null,
    vehicleLicensePlate: string | null,
    name: string | null,
    manager?: EntityManager,
  ) {
    const insertQuery = `
      INSERT INTO driver_profile (msisdn, driver_license_no, vehicle_license_plate, name)
      VALUES ($1, $2, $3, $4)
      RETURNING id, msisdn, role
    `;

    const executor = this.getExecutor(manager);

    const [driver] = await executor.query(insertQuery, [
      msisdn,
      driverLicenseNo,
      vehicleLicensePlate,
      name,
    ]);

    return driver;
  }
  async upsertDriverByPhone(msisdn: string) {
    this.logger.log(`process upsert for phone number : ${msisdn}`);
    try {
      const upsertClientQuery = `
      INSERT INTO driver_profile (msisdn)
      VALUES ($1)
      ON CONFLICT (msisdn) DO NOTHING
    `;
      await this.dataSource.query(upsertClientQuery, [msisdn]);
    } catch (error) {
      this.logger.error(error.message);
    }
  }

  async findDriverByPhone(
    msisdn: string,
    manager?: EntityManager,
  ): Promise<any> {
    const findClientQuery = `
      SELECT id, msisdn, role FROM driver_profile
      WHERE msisdn=$1 AND status='ACTIVE'
    `;
    const executor = this.getExecutor(manager);
    return await executor.query(findClientQuery, [msisdn]);
  }

  async findDriverbyId(id: number) {
    const findClientByIdQuery = `
      SELECT id, msisdn, role FROM driver_profile
      WHERE id=$1 AND status='ACTIVE'
    `;
    return await this.dataSource.query(findClientByIdQuery, [id]);
  }
}
