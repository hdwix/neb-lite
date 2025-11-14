import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { Queue, QueueEvents, JobsOptions } from 'bullmq';
import { lastValueFrom } from 'rxjs';
import { AxiosError } from 'axios';
import { Ride } from '../entities/ride.entity';
import { RidePaymentDetailRepository } from '../../infrastructure/repositories/ride-payment-detail.repository';
import { RidePaymentDetail } from '../entities/ride-payment-detail.entity';
import { PaymentOutboxRepository } from '../../infrastructure/repositories/payment-outbox.repository';
import {
  PaymentOutboxStatus,
  PaymentQueueJob,
  PAYMENT_QUEUE_ATTEMPTS,
  PAYMENT_QUEUE_BACKOFF_MS,
  PAYMENT_QUEUE_NAME,
  PAYMENT_QUEUE_TIMEOUT_MS,
} from '../constants/payment.constants';
import { PaymentNotificationDto } from '../../app/dto/payment-notification.dto';
import { monotonicFactory } from 'ulid';

export interface PaymentQueueJobData {
  outboxId: string;
}

export interface PaymentJobResult {
  paymentDetailId: string;
  status: string;
  token: string | null;
  redirectUrl: string | null;
}

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);
  private readonly paymentApiUrl: string | null;
  private readonly paymentApiKey: string | null;
  private readonly paymentProvider = 'midtrans';

  constructor(
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
    private readonly ridePaymentDetailRepository: RidePaymentDetailRepository,
    private readonly paymentOutboxRepository: PaymentOutboxRepository,
    @InjectQueue(PAYMENT_QUEUE_NAME)
    private readonly paymentQueue: Queue<PaymentQueueJobData>,
  ) {
    this.paymentApiUrl =
      this.configService.get<string>('PAYMENT_API_URL') ?? null;
    this.paymentApiKey =
      this.configService.get<string>('PAYMENT_API_KEY') ?? null;
  }

  async initiatePayment(ride: Ride): Promise<RidePaymentDetail> {
    this.ensurePaymentConfiguration();

    let paymentDetail = await this.ridePaymentDetailRepository.findByRideId(
      ride.id,
    );
    if (paymentDetail?.token && paymentDetail.redirectUrl) {
      return paymentDetail;
    }

    if (!paymentDetail) {
      paymentDetail = this.ridePaymentDetailRepository.create({
        rideId: ride.id,
        provider: this.paymentProvider,
        status: 'pending',
      });
    }

    const orderId = paymentDetail.orderId ?? this.generateOrderId();

    const requestPayload = this.buildPaymentRequestPayload(ride, orderId);

    paymentDetail.status = 'queued';
    paymentDetail.orderId = orderId;
    paymentDetail.requestPayload = requestPayload;
    paymentDetail.responsePayload = null;
    paymentDetail.token = null;
    paymentDetail.redirectUrl = null;

    const { detail: persistedDetail, outbox: savedOutbox } =
      await this.paymentOutboxRepository.saveDetailAndOutbox(paymentDetail, {
        orderId,
        requestPayload,
        status: PaymentOutboxStatus.Pending,
      });

    paymentDetail = persistedDetail;

    const jobOptions: JobsOptions & { timeout?: number } = {
      jobId: `ride-${ride.id}-payment-${savedOutbox.id}`,
      attempts: PAYMENT_QUEUE_ATTEMPTS,
      removeOnComplete: 50,
      removeOnFail: 50,
      backoff: { type: 'exponential', delay: PAYMENT_QUEUE_BACKOFF_MS },
      timeout: PAYMENT_QUEUE_TIMEOUT_MS,
    };

    const job = await this.paymentQueue.add(
      PaymentQueueJob.InitiatePayment,
      { outboxId: savedOutbox.id },
      jobOptions,
    );

    savedOutbox.jobId = job.id ?? savedOutbox.jobId ?? null;
    await this.paymentOutboxRepository.save(savedOutbox);

    const queueEvents = await this.createQueueEvents();
    try {
      await job.waitUntilFinished(queueEvents, PAYMENT_QUEUE_TIMEOUT_MS);
    } catch (error) {
      this.logger.error(
        `Payment initiation job failed for ride ${ride.id}: ${this.stringifyError(error)}`,
      );
      throw new BadRequestException('Failed to initiate payment');
    } finally {
      await queueEvents
        .close()
        .catch((closeError) =>
          this.logger.error(
            `Failed to close payment queue events for ride ${ride.id}: ${closeError}`,
          ),
        );
    }

    const refreshedDetail = await this.ridePaymentDetailRepository.findById(
      paymentDetail.id,
    );

    if (!refreshedDetail) {
      throw new BadRequestException(
        'Payment detail not found after processing',
      );
    }

    if (!refreshedDetail.redirectUrl) {
      throw new BadRequestException(
        'Payment gateway did not return a redirect URL',
      );
    }

    return refreshedDetail;
  }

  private generateOrderId(): string {
    const ulid = monotonicFactory();
    const orderId = ulid(Date.now());
    return orderId;
  }

  async processOutbox(outboxId: string): Promise<PaymentJobResult> {
    this.ensurePaymentConfiguration();
    const outbox = await this.paymentOutboxRepository.findById(outboxId);

    if (!outbox) {
      throw new Error(`Payment outbox entry ${outboxId} not found`);
    }

    const paymentDetail = await this.ridePaymentDetailRepository.findById(
      outbox.paymentDetailId,
    );

    if (!paymentDetail) {
      throw new Error(
        `Payment detail ${outbox.paymentDetailId} not found for outbox ${outboxId}`,
      );
    }

    outbox.status = PaymentOutboxStatus.Processing;
    outbox.attempts = (outbox.attempts ?? 0) + 1;
    outbox.lastAttemptedAt = new Date();
    await this.paymentOutboxRepository.save(outbox);

    try {
      const response = await lastValueFrom(
        this.httpService.post(this.paymentApiUrl!, outbox.requestPayload, {
          headers: this.buildPaymentHeaders(),
        }),
      );

      const responsePayload =
        (response?.data as Record<string, unknown>) ?? null;

      paymentDetail.status = 'initiated';
      paymentDetail.responsePayload = responsePayload;
      paymentDetail.requestPayload = outbox.requestPayload;
      paymentDetail.orderId = outbox.orderId;
      paymentDetail.token = this.extractResponseString(
        responsePayload,
        'token',
      );
      paymentDetail.redirectUrl = this.extractResponseString(
        responsePayload,
        'redirect_url',
      );

      const savedDetail =
        await this.ridePaymentDetailRepository.save(paymentDetail);

      outbox.status = PaymentOutboxStatus.Completed;
      outbox.lastError = null;
      outbox.processedAt = new Date();
      await this.paymentOutboxRepository.save(outbox);

      return {
        paymentDetailId: savedDetail.id,
        status: savedDetail.status,
        token: savedDetail.token ?? null,
        redirectUrl: savedDetail.redirectUrl ?? null,
      };
    } catch (error) {
      const message = this.describePaymentError(error);
      outbox.status = PaymentOutboxStatus.Failed;
      outbox.lastError = message;
      await this.paymentOutboxRepository.save(outbox);

      paymentDetail.status = 'failed';
      paymentDetail.responsePayload = null;
      await this.ridePaymentDetailRepository.save(paymentDetail);

      this.logger.error(
        `Payment processing failed for ride ${outbox.rideId}: ${message}`,
      );

      throw new Error(message);
    }
  }

  async applyNotification(
    ride: Ride,
    payload: PaymentNotificationDto,
  ): Promise<{ detail: RidePaymentDetail; paid: boolean }> {
    const orderId = payload.order_id ?? ride.id;

    let paymentDetail =
      (await this.ridePaymentDetailRepository.findByOrderId(orderId)) ??
      (await this.ridePaymentDetailRepository.findByRideId(ride.id));

    if (!paymentDetail) {
      paymentDetail = this.ridePaymentDetailRepository.create({
        rideId: ride.id,
        provider: this.paymentProvider,
        status: 'unknown',
        orderId,
      });
    }

    const status = payload.transaction_status?.toLowerCase?.() ?? 'unknown';

    paymentDetail.status = status;
    paymentDetail.orderId = orderId;
    paymentDetail.providerTransactionId = payload.transaction_id ?? null;
    paymentDetail.notificationPayload = this.cloneNotificationPayload(payload);

    const savedDetail =
      await this.ridePaymentDetailRepository.save(paymentDetail);
    const paid = this.isSuccessfulPaymentStatus(status);

    return { detail: savedDetail, paid };
  }

  formatPaymentDetail(
    detail: RidePaymentDetail | null,
  ): Record<string, unknown> | null {
    if (!detail) {
      return null;
    }

    return {
      id: detail.id,
      provider: detail.provider,
      status: detail.status,
      token: detail.token ?? null,
      redirectUrl: detail.redirectUrl ?? null,
      orderId: detail.orderId ?? null,
      providerTransactionId: detail.providerTransactionId ?? null,
    };
  }

  private async createQueueEvents(): Promise<QueueEvents> {
    return new QueueEvents(this.paymentQueue.name, {
      connection: this.paymentQueue.opts.connection,
    });
  }

  private ensurePaymentConfiguration(): void {
    if (!this.paymentApiUrl || !this.paymentApiKey) {
      throw new BadRequestException('Payment service is not configured');
    }
  }

  private buildPaymentRequestPayload(
    ride: Ride,
    orderId: string,
  ): Record<string, any> & {
    transaction_details: { order_id: string; gross_amount: number };
  } {
    const finalFare = this.parseCurrency(ride.fareFinal);
    const appFee = this.parseCurrency(ride.appFeeAmount);
    const grossAmount = this.roundCurrency(finalFare + appFee);

    if (grossAmount <= 0) {
      throw new BadRequestException('Ride does not have a payable amount');
    }

    return {
      transaction_details: {
        order_id: orderId,
        gross_amount: grossAmount,
      },
      credit_card: {
        secure: true,
      },
      customer_details: {
        first_name: `rider_${ride.riderId}`,
        last_name: '',
        email: `${ride.riderId}@example.com`,
        phone: ride.riderId,
      },
    };
  }

  private buildPaymentHeaders(): Record<string, string> {
    return {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Basic ${this.paymentApiKey}`,
    };
  }

  private extractResponseString(
    payload: Record<string, unknown> | null,
    key: string,
  ): string | null {
    if (!payload) {
      return null;
    }

    const value = payload[key];
    return typeof value === 'string' ? value : null;
  }

  private describePaymentError(error: unknown): string {
    if (this.isAxiosError(error)) {
      const axiosError = error as AxiosError;
      const status = axiosError.response?.status;
      const data = axiosError.response?.data;
      const serializedData =
        typeof data === 'string' ? data : JSON.stringify(data ?? {});
      return `Payment API request failed (${status ?? 'unknown status'}): ${serializedData}`;
    }

    if (error instanceof Error) {
      return `Payment API request failed: ${error.message}`;
    }

    return 'Payment API request failed with unknown error';
  }

  private parseCurrency(value?: string | null): number {
    if (value === undefined || value === null) {
      return 0;
    }

    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private roundCurrency(value: number): number {
    if (!Number.isFinite(value)) {
      return 0;
    }

    return Math.round(value * 100) / 100;
  }

  private stringifyError(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    return JSON.stringify(error);
  }

  private isAxiosError(error: unknown): error is AxiosError {
    return !!error && typeof error === 'object' && 'isAxiosError' in error;
  }

  private isSuccessfulPaymentStatus(status: string): boolean {
    const normalized = status?.toLowerCase?.() ?? '';
    return ['capture', 'settlement', 'success', 'completed'].includes(
      normalized,
    );
  }

  private cloneNotificationPayload(
    payload: PaymentNotificationDto,
  ): Record<string, unknown> {
    return { ...payload } as Record<string, unknown>;
  }
}
