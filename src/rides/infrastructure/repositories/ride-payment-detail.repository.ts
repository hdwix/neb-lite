import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, QueryRunner } from 'typeorm';
import { RidePaymentDetail } from '../../domain/entities/ride-payment-detail.entity';
import { PaymentOutboxStatus } from '../../domain/constants/payment.constants';
import { ERidePaymentDetailStatus } from '../../domain/constants/ride-payment-detail-status.enum';

@Injectable()
export class RidePaymentDetailRepository {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  create(data: Partial<RidePaymentDetail>): RidePaymentDetail {
    const detail = new RidePaymentDetail();
    detail.id = data.id ?? detail.id;
    detail.rideId = data.rideId ?? detail.rideId;
    detail.provider = data.provider ?? detail.provider;
    detail.status =
      data.status ?? detail.status ?? ERidePaymentDetailStatus.PENDING;
    detail.token = data.token ?? null;
    detail.redirectUrl = data.redirectUrl ?? null;
    detail.orderId = data.orderId ?? null;
    detail.providerTransactionId = data.providerTransactionId ?? null;
    detail.requestPayload = data.requestPayload ?? null;
    detail.responsePayload = data.responsePayload ?? null;
    detail.notificationPayload = data.notificationPayload ?? null;
    detail.createdAt = data.createdAt ?? detail.createdAt;
    detail.updatedAt = data.updatedAt ?? detail.updatedAt;
    return detail;
  }

  async save(
    detail: RidePaymentDetail,
    queryRunner?: QueryRunner,
  ): Promise<RidePaymentDetail> {
    const executor = queryRunner ?? this.dataSource;
    return this.persistDetail(detail, executor);
  }

  private async persistDetail(
    detail: RidePaymentDetail,
    executor: DataSource | QueryRunner,
  ): Promise<RidePaymentDetail> {
    const rows = await executor.query(
      `
        INSERT INTO ride_payment_details (
          ride_id,
          provider,
          status,
          token,
          redirect_url,
          order_id,
          provider_transaction_id,
          request_payload,
          response_payload,
          notification_payload,
          created_at,
          updated_at
        ) VALUES (
          $1::bigint,
          $2,
          $3,
          $4,
          $5,
          $6,
          $7,
          $8::jsonb,
          $9::jsonb,
          $10::jsonb,
          COALESCE($11, NOW()),
          NOW()
        )
        ON CONFLICT (ride_id) DO UPDATE SET
          provider = EXCLUDED.provider,
          status = EXCLUDED.status,
          token = EXCLUDED.token,
          redirect_url = EXCLUDED.redirect_url,
          order_id = EXCLUDED.order_id,
          provider_transaction_id = EXCLUDED.provider_transaction_id,
          request_payload = EXCLUDED.request_payload,
          response_payload = EXCLUDED.response_payload,
          notification_payload = EXCLUDED.notification_payload,
          updated_at = NOW()
        RETURNING
          id,
          ride_id,
          provider,
          status,
          token,
          redirect_url,
          order_id,
          provider_transaction_id,
          request_payload,
          response_payload,
          notification_payload,
          created_at,
          updated_at;
      `,
      [
        detail.rideId,
        detail.provider,
        detail.status,
        detail.token ?? null,
        detail.redirectUrl ?? null,
        detail.orderId ?? null,
        detail.providerTransactionId ?? null,
        detail.requestPayload ? JSON.stringify(detail.requestPayload) : null,
        detail.responsePayload ? JSON.stringify(detail.responsePayload) : null,
        detail.notificationPayload
          ? JSON.stringify(detail.notificationPayload)
          : null,
        detail.createdAt ?? null,
      ],
    );

    if (!rows?.length) {
      throw new Error('Failed to persist ride payment detail');
    }

    return this.mapRowToEntity(rows[0]);
  }

  async findById(
    id: string,
    queryRunner?: QueryRunner,
  ): Promise<RidePaymentDetail | null> {
    const executor = queryRunner ?? this.dataSource;
    const rows = await executor.query(
      `
        SELECT
          id,
          ride_id,
          provider,
          status,
          token,
          redirect_url,
          order_id,
          provider_transaction_id,
          request_payload,
          response_payload,
          notification_payload,
          created_at,
          updated_at
        FROM ride_payment_details
        WHERE id = $1::bigint
        LIMIT 1;
      `,
      [id],
    );

    if (!rows?.length) {
      return null;
    }

    return this.mapRowToEntity(rows[0]);
  }

  async findByRideId(
    rideId: string,
    queryRunner?: QueryRunner,
  ): Promise<RidePaymentDetail | null> {
    const executor = queryRunner ?? this.dataSource;
    const rows = await executor.query(
      `
        SELECT
          id,
          ride_id,
          provider,
          status,
          token,
          redirect_url,
          order_id,
          provider_transaction_id,
          request_payload,
          response_payload,
          notification_payload,
          created_at,
          updated_at
        FROM ride_payment_details
        WHERE ride_id = $1::bigint
        LIMIT 1;
      `,
      [rideId],
    );

    if (!rows?.length) {
      return null;
    }

    return this.mapRowToEntity(rows[0]);
  }

  async findByOrderId(
    orderId: string,
    queryRunner?: QueryRunner,
  ): Promise<RidePaymentDetail | null> {
    const executor = queryRunner ?? this.dataSource;
    const rows = await executor.query(
      `
        SELECT
          id,
          ride_id,
          provider,
          status,
          token,
          redirect_url,
          order_id,
          provider_transaction_id,
          request_payload,
          response_payload,
          notification_payload,
          created_at,
          updated_at
        FROM ride_payment_details
        WHERE order_id = $1
        LIMIT 1;
      `,
      [orderId],
    );

    if (!rows?.length) {
      return null;
    }

    return this.mapRowToEntity(rows[0]);
  }

  async saveDetailWithRideUpdate(options: {
    detail: RidePaymentDetail;
    rideUpdate?: {
      rideId: string;
      paymentStatus?: string | null;
      paymentUrl?: string | null;
    };
    outboxUpdate?: {
      rideId?: string | null;
      paymentDetailId?: string | null;
      orderId: string;
      status: PaymentOutboxStatus;
      lastError?: string | null;
      setProcessedAt?: boolean;
    };
  }): Promise<RidePaymentDetail> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();

    try {
      await queryRunner.query('BEGIN');
      const savedDetail = await this.persistDetail(options.detail, queryRunner);

      if (options.rideUpdate) {
        const rows = await queryRunner.query(
          `
            UPDATE rides
            SET
              payment_status = $2,
              payment_url = $3,
              updated_at = NOW()
            WHERE id = $1::bigint
            RETURNING id;
          `,
          [
            options.rideUpdate.rideId,
            options.rideUpdate.paymentStatus ?? null,
            options.rideUpdate.paymentUrl ?? null,
          ],
        );

        if (!rows?.length) {
          throw new Error('Ride not found while updating payment status');
        }
      }

      if (options.outboxUpdate) {
        const outboxRows = await queryRunner.query(
          `
            UPDATE ride_payment_outbox
            SET
              status = $4,
              last_error = $5,
              processed_at = CASE WHEN $6 THEN NOW() ELSE processed_at END,
              updated_at = NOW()
            WHERE order_id = $1
              AND ($2::bigint IS NULL OR ride_id = $2::bigint)
              AND ($3::bigint IS NULL OR payment_detail_id = $3::bigint)
            RETURNING id;
          `,
          [
            options.outboxUpdate.orderId,
            options.outboxUpdate.rideId ?? null,
            options.outboxUpdate.paymentDetailId ?? null,
            options.outboxUpdate.status,
            options.outboxUpdate.lastError ?? null,
            options.outboxUpdate.setProcessedAt ? true : false,
          ],
        );

        if (!outboxRows?.length) {
          throw new Error('Payment outbox entry not found while updating status');
        }
      }

      await queryRunner.query('COMMIT');
      return savedDetail;
    } catch (error) {
      await queryRunner.query('ROLLBACK');
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  private mapRowToEntity(row: Record<string, any>): RidePaymentDetail {
    const detail = new RidePaymentDetail();
    detail.id = row.id?.toString();
    detail.rideId = row.ride_id?.toString();
    detail.provider = row.provider;
    detail.status = this.normalizeStatus(row.status);
    detail.token = row.token ?? null;
    detail.redirectUrl = row.redirect_url ?? null;
    detail.orderId = row.order_id ?? null;
    detail.providerTransactionId = row.provider_transaction_id ?? null;
    detail.requestPayload = this.parseJsonColumn(row.request_payload);
    detail.responsePayload = this.parseJsonColumn(row.response_payload);
    detail.notificationPayload = this.parseJsonColumn(row.notification_payload);
    detail.createdAt = row.created_at ? new Date(row.created_at) : detail.createdAt;
    detail.updatedAt = row.updated_at ? new Date(row.updated_at) : detail.updatedAt;
    return detail;
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

  private normalizeStatus(status: unknown): ERidePaymentDetailStatus {
    const normalized = status?.toString?.().toLowerCase?.();
    const allowed = new Set(Object.values(ERidePaymentDetailStatus));
    if (normalized && allowed.has(normalized as ERidePaymentDetailStatus)) {
      return normalized as ERidePaymentDetailStatus;
    }
    return ERidePaymentDetailStatus.UNKNOWN;
  }
}
