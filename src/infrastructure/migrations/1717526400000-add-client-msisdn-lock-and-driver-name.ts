import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddClientMsisdnLockAndDriverName1717526400000
  implements MigrationInterface
{
  name = 'AddClientMsisdnLockAndDriverName1717526400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS client_msisdn_lock (
        msisdn varchar(32) PRIMARY KEY,
        client_type varchar(10) NOT NULL,
        CONSTRAINT chk_client_msisdn_lock_client_type CHECK (client_type IN ('RIDER', 'DRIVER'))
      )
    `);

    await queryRunner.query(`
      ALTER TABLE driver_profile
      ADD COLUMN IF NOT EXISTS name text
    `);

    await queryRunner.query(`
      ALTER TABLE driver_profile
      ALTER COLUMN driver_license_no TYPE text
      USING driver_license_no::text
    `);

    await queryRunner.query(`
      ALTER TABLE driver_profile
      ALTER COLUMN vehicle_license_plate TYPE text
      USING vehicle_license_plate::text
    `);

    await queryRunner.query(`
      INSERT INTO client_msisdn_lock (msisdn, client_type)
      SELECT msisdn, role
      FROM rider_profile
      WHERE status = 'ACTIVE'
      ON CONFLICT (msisdn) DO NOTHING
    `);

    await queryRunner.query(`
      INSERT INTO client_msisdn_lock (msisdn, client_type)
      SELECT msisdn, role
      FROM driver_profile
      WHERE status = 'ACTIVE'
      ON CONFLICT (msisdn) DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM client_msisdn_lock
    `);

    await queryRunner.query(`
      DROP TABLE IF EXISTS client_msisdn_lock
    `);

    await queryRunner.query(`
      ALTER TABLE driver_profile
      DROP COLUMN IF EXISTS name
    `);

    await queryRunner.query(`
      ALTER TABLE driver_profile
      ALTER COLUMN driver_license_no TYPE varchar(64)
    `);

    await queryRunner.query(`
      ALTER TABLE driver_profile
      ALTER COLUMN vehicle_license_plate TYPE varchar(32)
    `);
  }
}
