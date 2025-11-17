import { MigrationInterface, QueryRunner } from 'typeorm';

export class PrimaryKeysAndIndexes1733300000000 implements MigrationInterface {
  name = 'PrimaryKeysAndIndexes1733300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE IF EXISTS ride_payment_outbox
      DROP CONSTRAINT IF EXISTS ride_payment_outbox_pkey;
    `);

    await queryRunner.query(`
      ALTER TABLE IF EXISTS ride_payment_outbox
      DROP COLUMN IF EXISTS id;
    `);

    await queryRunner.query(`
      ALTER TABLE IF EXISTS ride_payment_outbox
      ADD COLUMN IF NOT EXISTS id BIGSERIAL PRIMARY KEY;
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS ix_driver_profile_msisdn_status
        ON driver_profile(msisdn, status)
        INCLUDE (id, role);
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS ix_rider_profile_msisdn_status
        ON rider_profile(msisdn, status)
        INCLUDE (id, role);
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS ix_ride_driver_candidates_ride_driver
        ON ride_driver_candidates(ride_id, driver_id)
        INCLUDE (status, distance_meters, reason, responded_at, created_at, updated_at);
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS ix_ride_driver_candidates_ride_created
        ON ride_driver_candidates(ride_id, created_at)
        INCLUDE (driver_id, status, distance_meters);
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS ix_ride_payment_details_order_id
        ON ride_payment_details(order_id)
        INCLUDE (
          id,
          ride_id,
          provider,
          status,
          token,
          redirect_url
        );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS ix_ride_payment_outbox_ride_status
        ON ride_payment_outbox(ride_id, status)
        INCLUDE (
          id,
          payment_detail_id,
          order_id
        );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS ix_ride_status_history_ride
        ON ride_status_history(ride_id)
        INCLUDE (from_status, to_status);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS ix_ride_status_history_ride;
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS ix_ride_payment_outbox_ride_status;
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS ix_ride_payment_details_order_id;
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS ix_ride_driver_candidates_ride_created;
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS ix_ride_driver_candidates_ride_driver;
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS ix_rider_profile_msisdn_status;
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS ix_driver_profile_msisdn_status;
    `);

    await queryRunner.query(`
      ALTER TABLE IF EXISTS ride_payment_outbox
      DROP CONSTRAINT IF EXISTS ride_payment_outbox_pkey;
    `);

    await queryRunner.query(`
      ALTER TABLE IF EXISTS ride_payment_outbox
      DROP COLUMN IF EXISTS id;
    `);

    await queryRunner.query(`
      ALTER TABLE IF EXISTS ride_payment_outbox
      ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() PRIMARY KEY;
    `);
  }
}
