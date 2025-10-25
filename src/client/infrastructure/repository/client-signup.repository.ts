import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';

@Injectable()
export class ClientSignupRepository {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

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
        'SELECT GET_LOCK(?, 5) AS acquired',
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
          await queryRunner.query('SELECT RELEASE_LOCK(?)', [lockKey]);
        }
      } finally {
        if (!queryRunner.isReleased) {
          await queryRunner.release();
        }
      }
    }
  }
}
