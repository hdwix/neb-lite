import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { Repository, DataSource, EntityManager } from 'typeorm';
import { InjectDataSource } from '@nestjs/typeorm';
import { RiderProfile } from '../../domain/entities/rider-profile.entity';

@Injectable()
export class RiderProfileRepository extends Repository<RiderProfile> {
  private readonly logger = new Logger(RiderProfileRepository.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {
    super(RiderProfile, dataSource.createEntityManager());
  }

  private getExecutor(manager?: EntityManager) {
    return manager ?? this.dataSource;
  }

  async withSignupLock<T>(
    msisdn: string,
    fallbackErrorMessage: string,
    work: (manager: EntityManager) => Promise<T>,
  ): Promise<T> {
    const lockKey = `client_signup_lock:${msisdn}`;
    const queryRunner = this.dataSource.createQueryRunner();
    let lockAcquired = false;

    try {
      await queryRunner.connect();
      await queryRunner.startTransaction();

      const [lockResult] = await queryRunner.query(
        'SELECT pg_try_advisory_lock(hashtext($1::text)) AS acquired',
        [lockKey],
      );

      if (!lockResult?.acquired) {
        throw new ConflictException(
          'Registration is currently being processed, please try again.',
        );
      }

      lockAcquired = true;

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
        if (lockAcquired && !queryRunner.isReleased) {
          await queryRunner.query(
            'SELECT pg_advisory_unlock(hashtext($1::text)) AS released',
            [lockKey],
          );
        }
      } finally {
        if (!queryRunner.isReleased) {
          await queryRunner.release();
        }
      }
    }
  }

  async createRiderProfile(
    msisdn: string,
    name: string | null,
    manager?: EntityManager,
  ) {
    const insertQuery = `
      INSERT INTO rider_profile (msisdn, name)
      VALUES ($1, $2)
      RETURNING id, msisdn, role
    `;

    const executor = this.getExecutor(manager);

    const [rider] = await executor.query(insertQuery, [
      msisdn,
      name,
    ]);

    return rider;
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

  async findRiderByPhone(phone: string, manager?: EntityManager): Promise<any> {
    const findClientQuery = `
      SELECT id, msisdn, role FROM rider_profile
      WHERE msisdn=$1 AND status='ACTIVE'
    `;
    const executor = this.getExecutor(manager);
    return await executor.query(findClientQuery, [phone]);
  }

  async findRiderbyId(id: number) {
    const findClientByIdQuery = `
      SELECT id, msisdn, role FROM rider_profile
      WHERE id=$1 AND status='ACTIVE'
    `;
    return await this.dataSource.query(findClientByIdQuery, [id]);
  }
}
