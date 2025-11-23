import { MigrationInterface, QueryRunner } from 'typeorm';

export class AlignForeignKeyTypes1733400000001 implements MigrationInterface {
  name = 'AlignForeignKeyTypes1733400000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE IF EXISTS rides
      DROP CONSTRAINT IF EXISTS fk_rides_rider;
    `);

    await queryRunner.query(`
      ALTER TABLE IF EXISTS rides
      DROP CONSTRAINT IF EXISTS fk_rides_driver;
    `);

    await queryRunner.query(`
      ALTER TABLE IF EXISTS ride_driver_candidates
      DROP CONSTRAINT IF EXISTS fk_ride_driver_candidates_driver;
    `);

    await queryRunner.query(`
      ALTER TABLE IF EXISTS ride_driver_candidates
      DROP CONSTRAINT IF EXISTS fk_ride_driver_candidates_ride;
    `);

    await queryRunner.query(`
      ALTER TABLE IF EXISTS rides
      ALTER COLUMN rider_id TYPE bigint USING rider_id::bigint;
    `);

    await queryRunner.query(`
      ALTER TABLE IF EXISTS rides
      ALTER COLUMN driver_id TYPE bigint USING driver_id::bigint;
    `);

    await queryRunner.query(`
      ALTER TABLE IF EXISTS ride_driver_candidates
      ALTER COLUMN driver_id TYPE bigint USING driver_id::bigint;
    `);

    await queryRunner.query(`
      ALTER TABLE IF EXISTS rides
      ADD CONSTRAINT fk_rides_rider
      FOREIGN KEY (rider_id) REFERENCES rider_profile(id);
    `);

    await queryRunner.query(`
      ALTER TABLE IF EXISTS rides
      ADD CONSTRAINT fk_rides_driver
      FOREIGN KEY (driver_id) REFERENCES driver_profile(id);
    `);

    await queryRunner.query(`
      ALTER TABLE IF EXISTS ride_driver_candidates
      ADD CONSTRAINT fk_ride_driver_candidates_driver
      FOREIGN KEY (driver_id) REFERENCES driver_profile(id);
    `);

    await queryRunner.query(`
      ALTER TABLE IF EXISTS ride_driver_candidates
      ADD CONSTRAINT fk_ride_driver_candidates_ride
      FOREIGN KEY (ride_id) REFERENCES rides(id);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE IF EXISTS ride_driver_candidates
      DROP CONSTRAINT IF EXISTS fk_ride_driver_candidates_ride;
    `);

    await queryRunner.query(`
      ALTER TABLE IF EXISTS ride_driver_candidates
      DROP CONSTRAINT IF EXISTS fk_ride_driver_candidates_driver;
    `);

    await queryRunner.query(`
      ALTER TABLE IF EXISTS rides
      DROP CONSTRAINT IF EXISTS fk_rides_driver;
    `);

    await queryRunner.query(`
      ALTER TABLE IF EXISTS rides
      DROP CONSTRAINT IF EXISTS fk_rides_rider;
    `);

    await queryRunner.query(`
      ALTER TABLE IF EXISTS ride_driver_candidates
      ALTER COLUMN driver_id TYPE varchar(64) USING driver_id::varchar;
    `);

    await queryRunner.query(`
      ALTER TABLE IF EXISTS rides
      ALTER COLUMN driver_id TYPE varchar(64) USING driver_id::varchar;
    `);

    await queryRunner.query(`
      ALTER TABLE IF EXISTS rides
      ALTER COLUMN rider_id TYPE varchar(64) USING rider_id::varchar;
    `);
  }
}
