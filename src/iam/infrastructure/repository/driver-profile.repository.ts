/* istanbul ignore file */
import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { InjectDataSource } from '@nestjs/typeorm';

@Injectable()
export class DriverProfileRepository {
  private readonly logger = new Logger(DriverProfileRepository.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  private getExecutor(manager?: EntityManager) {
    return manager ?? this.dataSource;
  }

  async createDriverProfileWithLock(
    msisdn: string,
    driverLicenseNo: string | null,
    vehicleLicensePlate: string | null,
    name: string | null,
    beforeInsert?: (manager: EntityManager) => Promise<void>,
  ) {
    return this.executeWithSignupLock(
      msisdn,
      'Failed to create driver profile',
      async (manager) => {
        if (beforeInsert) {
          await beforeInsert(manager);
        }

        const insertQuery = `
          INSERT INTO driver_profile (msisdn, driver_license_no, vehicle_license_plate, name)
          VALUES ($1, $2, $3, $4)
          RETURNING id, msisdn, role
        `;

        const [driver] = await manager.query(insertQuery, [
          msisdn,
          driverLicenseNo,
          vehicleLicensePlate,
          name,
        ]);

        if (!driver) {
          throw new InternalServerErrorException(
            'Failed to create driver profile',
          );
        }

        return driver;
      },
    );
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

  async findDriverbyId(id: string) {
    const findClientByIdQuery = `
      SELECT id, msisdn, role FROM driver_profile
      WHERE id=$1 AND status='ACTIVE'
    `;
    return await this.dataSource.query(findClientByIdQuery, [id]);
  }

  private getSignupLockKeys(msisdn: string) {
    return [
      `client_signup_lock:driver_profile:${msisdn}`,
      `client_signup_lock:rider_profile:${msisdn}`,
    ];
  }

  private async executeWithSignupLock<T>(
    msisdn: string,
    fallbackErrorMessage: string,
    work: (manager: EntityManager) => Promise<T>,
  ): Promise<T> {
    const lockKeys = this.getSignupLockKeys(msisdn);
    const queryRunner = this.dataSource.createQueryRunner();
    const acquiredLocks: string[] = [];

    try {
      await queryRunner.connect();

      for (const lockKey of lockKeys) {
        const [lockResult] = await queryRunner.query(
          'SELECT pg_try_advisory_lock(hashtext($1::text)) AS acquired',
          [lockKey],
        );

        if (!lockResult?.acquired) {
          throw new ConflictException(
            'Registration is currently being processed, please try again.',
          );
        }

        acquiredLocks.push(lockKey);
      }

      await queryRunner.startTransaction();

      const result = await work(queryRunner.manager);

      await queryRunner.commitTransaction();

      return result;
    } catch (error) {
      if (queryRunner.isTransactionActive) {
        await queryRunner.rollbackTransaction();
      }

      if (
        error instanceof ConflictException ||
        error instanceof InternalServerErrorException
      ) {
        throw error;
      }

      throw new InternalServerErrorException(fallbackErrorMessage);
    } finally {
      try {
        if (!queryRunner.isReleased) {
          for (const lockKey of acquiredLocks.reverse()) {
            await queryRunner.query(
              'SELECT pg_advisory_unlock(hashtext($1::text)) AS released',
              [lockKey],
            );
          }
        }
      } finally {
        if (!queryRunner.isReleased) {
          await queryRunner.release();
        }
      }
    }
  }
}
