import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, QueryRunner } from 'typeorm';
import { PaymentOutbox } from '../../domain/entities/payment-outbox.entity';
import { PaymentOutboxStatus } from '../../domain/constants/payment.constants';
import { RidePaymentDetail } from '../../domain/entities/ride-payment-detail.entity';
import { RidePaymentDetailRepository } from './ride-payment-detail.repository';

@Injectable()
export class PaymentOutboxRepository {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly ridePaymentDetailRepository: RidePaymentDetailRepository,
  ) {}

  create(data: Partial<PaymentOutbox>): PaymentOutbox {
    const outbox = new PaymentOutbox();
    outbox.id = data.id ?? outbox.id;
    outbox.rideId = data.rideId ?? outbox.rideId;
    outbox.paymentDetailId = data.paymentDetailId ?? outbox.paymentDetailId;
    outbox.orderId = data.orderId ?? outbox.orderId;
    outbox.status = data.status ?? outbox.status;
    outbox.attempts = data.attempts ?? 0;
    outbox.jobId = data.jobId ?? null;
    outbox.requestPayload = data.requestPayload ?? {};
    outbox.lastError = data.lastError ?? null;
    outbox.lastAttemptedAt = data.lastAttemptedAt ?? null;
    outbox.processedAt = data.processedAt ?? null;
    outbox.createdAt = data.createdAt ?? outbox.createdAt;
    outbox.updatedAt = data.updatedAt ?? outbox.updatedAt;
    return outbox;
  }

  async save(outbox: PaymentOutbox): Promise<PaymentOutbox> {
    if (!outbox.id) {
      throw new Error('Outbox id is required for updates');
    }

    const rows = await this.dataSource.query(
      `
        INSERT INTO ride_payment_outbox (
          id,
          ride_id,
          payment_detail_id,
          order_id,
          status,
          attempts,
          job_id,
          request_payload,
          last_error,
          last_attempted_at,
          processed_at,
          created_at,
          updated_at
        ) VALUES (
          $1::uuid,
          $2::bigint,
          $3::bigint,
          $4,
          $5,
          $6,
          $7,
          $8::jsonb,
          $9,
          $10,
          $11,
          COALESCE($12, NOW()),
          NOW()
        )
        ON CONFLICT (id) DO UPDATE SET
          status = EXCLUDED.status,
          attempts = EXCLUDED.attempts,
          job_id = EXCLUDED.job_id,
          request_payload = EXCLUDED.request_payload,
          last_error = EXCLUDED.last_error,
          last_attempted_at = EXCLUDED.last_attempted_at,
          processed_at = EXCLUDED.processed_at,
          updated_at = NOW()
        RETURNING
          id,
          ride_id,
          payment_detail_id,
          order_id,
          status,
          attempts,
          job_id,
          request_payload,
          last_error,
          last_attempted_at,
          processed_at,
          created_at,
          updated_at;
      `,
      [
        outbox.id,
        outbox.rideId,
        outbox.paymentDetailId,
        outbox.orderId,
        outbox.status,
        outbox.attempts ?? 0,
        outbox.jobId ?? null,
        outbox.requestPayload ? JSON.stringify(outbox.requestPayload) : '{}',
        outbox.lastError ?? null,
        outbox.lastAttemptedAt ?? null,
        outbox.processedAt ?? null,
        outbox.createdAt ?? null,
      ],
    );

    if (!rows?.length) {
      throw new Error('Failed to persist payment outbox');
    }

    return this.mapRowToEntity(rows[0]);
  }

  async saveDetailAndOutbox(
    detail: RidePaymentDetail,
    outbox: {
      orderId: string;
      requestPayload: Record<string, unknown>;
      status: PaymentOutboxStatus;
    },
  ): Promise<{ detail: RidePaymentDetail; outbox: PaymentOutbox }> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const savedDetail = await this.ridePaymentDetailRepository.save(
        detail,
        queryRunner,
      );

      const rows = await queryRunner.query(
        `
          INSERT INTO ride_payment_outbox (
            ride_id,
            payment_detail_id,
            order_id,
            status,
            attempts,
            job_id,
            request_payload,
            last_error,
            last_attempted_at,
            processed_at,
            created_at,
            updated_at
          ) VALUES (
            $1::bigint,
            $2::bigint,
            $3,
            $4,
            0,
            NULL,
            $5::jsonb,
            NULL,
            NULL,
            NULL,
            NOW(),
            NOW()
          )
          RETURNING
            id,
            ride_id,
            payment_detail_id,
            order_id,
            status,
            attempts,
            job_id,
            request_payload,
            last_error,
            last_attempted_at,
            processed_at,
            created_at,
            updated_at;
        `,
        [
          savedDetail.rideId,
          savedDetail.id,
          outbox.orderId,
          outbox.status,
          JSON.stringify(outbox.requestPayload ?? {}),
        ],
      );

      if (!rows?.length) {
        throw new Error('Failed to create payment outbox entry');
      }

      await queryRunner.commitTransaction();

      return {
        detail: savedDetail,
        outbox: this.mapRowToEntity(rows[0]),
      };
    } catch (error) {
      if (queryRunner.isTransactionActive) {
        await queryRunner.rollbackTransaction();
      }

      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async findById(id: string): Promise<PaymentOutbox | null> {
    const rows = await this.dataSource.query(
      `
        SELECT
          id,
          ride_id,
          payment_detail_id,
          order_id,
          status,
          attempts,
          job_id,
          request_payload,
          last_error,
          last_attempted_at,
          processed_at,
          created_at,
          updated_at
        FROM ride_payment_outbox
        WHERE id = $1::uuid
        LIMIT 1;
      `,
      [id],
    );

    if (!rows?.length) {
      return null;
    }

    return this.mapRowToEntity(rows[0]);
  }

  async findLatestPendingByRide(
    rideId: string,
  ): Promise<PaymentOutbox | null> {
    const rows = await this.dataSource.query(
      `
        SELECT
          id,
          ride_id,
          payment_detail_id,
          order_id,
          status,
          attempts,
          job_id,
          request_payload,
          last_error,
          last_attempted_at,
          processed_at,
          created_at,
          updated_at
        FROM ride_payment_outbox
        WHERE ride_id = $1::bigint
          AND status = $2
        ORDER BY created_at DESC
        LIMIT 1;
      `,
      [rideId, PaymentOutboxStatus.Pending],
    );

    if (!rows?.length) {
      return null;
    }

    return this.mapRowToEntity(rows[0]);
  }

  private mapRowToEntity(row: Record<string, any>): PaymentOutbox {
    const outbox = new PaymentOutbox();
    outbox.id = row.id ?? outbox.id;
    outbox.rideId = row.ride_id?.toString();
    outbox.paymentDetailId = row.payment_detail_id?.toString();
    outbox.orderId = row.order_id;
    outbox.status = row.status;
    outbox.attempts = Number(row.attempts ?? 0);
    outbox.jobId = row.job_id ?? null;
    outbox.requestPayload = this.parseJsonColumn(row.request_payload) ?? {};
    outbox.lastError = row.last_error ?? null;
    outbox.lastAttemptedAt = row.last_attempted_at
      ? new Date(row.last_attempted_at)
      : null;
    outbox.processedAt = row.processed_at ? new Date(row.processed_at) : null;
    outbox.createdAt = row.created_at ? new Date(row.created_at) : outbox.createdAt;
    outbox.updatedAt = row.updated_at ? new Date(row.updated_at) : outbox.updatedAt;
    return outbox;
  }

  private parseJsonColumn(value: unknown): Record<string, unknown> | null {
    if (!value) {
      return null;
    }

    if (typeof value === 'string') {
      try {
        return JSON.parse(value);
      } catch (error) {
        return null;
      }
    }

    return value as Record<string, unknown>;
  }
}
