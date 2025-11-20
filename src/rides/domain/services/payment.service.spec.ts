jest.mock('rxjs', () => ({
  lastValueFrom: jest.fn(),
}));

import { BadRequestException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { AxiosError } from 'axios';
import { Queue } from 'bullmq';
import { PaymentService } from './payment.service';
import { Ride } from '../entities/ride.entity';
import { RidePaymentDetailRepository } from '../../infrastructure/repositories/ride-payment-detail.repository';
import { PaymentOutboxRepository } from '../../infrastructure/repositories/payment-outbox.repository';
import { ERidePaymentDetailStatus } from '../constants/ride-payment-detail-status.enum';
import {
  PaymentOutboxStatus,
  PaymentQueueJob,
  PAYMENT_QUEUE_NAME,
} from '../constants/payment.constants';
import { PaymentNotificationDto } from '../../app/dto/payment-notification.dto';
import { PaymentJobResult } from './payment.service';
import { lastValueFrom } from 'rxjs';

describe('PaymentService', () => {
  let service: PaymentService;
  let configService: jest.Mocked<ConfigService>;
  let httpService: jest.Mocked<HttpService>;
  let ridePaymentDetailRepository: jest.Mocked<RidePaymentDetailRepository>;
  let paymentOutboxRepository: jest.Mocked<PaymentOutboxRepository>;
  let paymentQueue: jest.Mocked<Queue>;

  const ride: Ride = {
    id: 'ride-1',
    riderId: 'rider-1',
    fareFinal: '12000',
  } as Ride;

  beforeEach(() => {
    (lastValueFrom as jest.Mock).mockReset();

    configService = {
      get: jest.fn((key: string) => {
        const values: Record<string, string> = {
          PAYMENT_API_URL: 'https://api.example.com',
          PAYMENT_API_KEY: 'secret',
          PAYMENT_PROVIDER: 'testpay',
        };
        return values[key] ?? null;
      }),
    } as unknown as jest.Mocked<ConfigService>;

    httpService = {
      post: jest.fn(),
    } as unknown as jest.Mocked<HttpService>;

    ridePaymentDetailRepository = {
      findByRideId: jest.fn(),
      create: jest.fn(),
      findById: jest.fn(),
      save: jest.fn(),
    } as unknown as jest.Mocked<RidePaymentDetailRepository>;

    paymentOutboxRepository = {
      saveDetailAndOutbox: jest.fn(),
      save: jest.fn(),
      findById: jest.fn(),
    } as unknown as jest.Mocked<PaymentOutboxRepository>;

    paymentQueue = {
      name: PAYMENT_QUEUE_NAME,
      opts: { connection: {} },
      add: jest.fn(),
    } as unknown as jest.Mocked<Queue>;

    service = new PaymentService(
      configService,
      httpService,
      ridePaymentDetailRepository,
      paymentOutboxRepository,
      paymentQueue,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('throws when payment configuration is missing', async () => {
    configService.get.mockReturnValueOnce(null);
    const unconfigured = new PaymentService(
      configService,
      httpService,
      ridePaymentDetailRepository,
      paymentOutboxRepository,
      paymentQueue,
    );

    await expect(unconfigured.initiatePayment(ride)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('queues payment initiation and waits for completion', async () => {
    const detail = {
      id: 'detail-1',
      status: ERidePaymentDetailStatus.PENDING,
    } as any;
    const outbox = {
      id: 'outbox-1',
      paymentDetailId: 'detail-1',
      rideId: ride.id,
    } as any;

    ridePaymentDetailRepository.findByRideId.mockResolvedValue(null);
    ridePaymentDetailRepository.create.mockReturnValue(detail);
    paymentOutboxRepository.saveDetailAndOutbox.mockResolvedValue({
      detail,
      outbox,
    });

    const waitUntilFinished = jest.fn().mockResolvedValue(undefined);
    const job = { id: 'job-1', waitUntilFinished } as any;
    (paymentQueue.add as jest.Mock).mockResolvedValue(job);

    const queueEvents = {
      close: jest.fn().mockResolvedValue(undefined),
    } as any;
    const eventsSpy = jest
      .spyOn<any, any>(service as any, 'createQueueEvents')
      .mockResolvedValue(queueEvents);

    const refreshedDetail = {
      ...detail,
      redirectUrl: 'http://redirect',
      token: 'abc',
    } as any;
    ridePaymentDetailRepository.findById.mockResolvedValue(refreshedDetail);

    const result = await service.initiatePayment(ride);

    expect(eventsSpy).toHaveBeenCalled();
    expect(paymentQueue.add).toHaveBeenCalledWith(
      PaymentQueueJob.InitiatePayment,
      { outboxId: outbox.id },
      expect.objectContaining({ timeout: expect.any(Number) }),
    );
    expect(waitUntilFinished).toHaveBeenCalledWith(
      queueEvents,
      expect.any(Number),
    );
    expect(paymentOutboxRepository.save).toHaveBeenCalledWith({
      ...outbox,
      jobId: job.id,
    });
    expect(queueEvents.close).toHaveBeenCalled();
    expect(result).toBe(refreshedDetail);
  });

  it('processes outbox successfully and returns formatted result', async () => {
    const outbox = {
      id: 'outbox-1',
      paymentDetailId: 'detail-1',
      rideId: 'ride-1',
      requestPayload: { foo: 'bar' },
      status: PaymentOutboxStatus.Pending,
      attempts: 0,
    } as any;
    const paymentDetail = {
      id: 'detail-1',
      status: ERidePaymentDetailStatus.PENDING,
    } as any;

    paymentOutboxRepository.findById.mockResolvedValue(outbox);
    ridePaymentDetailRepository.findById.mockResolvedValue(paymentDetail);

    (lastValueFrom as jest.Mock).mockResolvedValue({
      data: { token: 'abc', redirect_url: 'url' },
    });

    ridePaymentDetailRepository.save.mockResolvedValue({
      ...paymentDetail,
      status: ERidePaymentDetailStatus.INITIATED,
      token: 'abc',
      redirectUrl: 'url',
    });

    const result = await service.processOutbox(outbox.id);

    expect(lastValueFrom).toHaveBeenCalled();
    expect(paymentOutboxRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: PaymentOutboxStatus.Completed }),
    );
    expect(result).toEqual<PaymentJobResult>({
      paymentDetailId: 'detail-1',
      status: ERidePaymentDetailStatus.INITIATED,
      token: 'abc',
      redirectUrl: 'url',
    });
  });

  it('marks outbox as failed and propagates error when payment request fails', async () => {
    const axiosError: AxiosError = {
      isAxiosError: true,
      message: 'boom',
      name: 'AxiosError',
      config: {},
      toJSON: () => ({}),
      response: {
        status: 500,
        data: { message: 'oops' },
        statusText: 'err',
        headers: {},
        config: {},
      },
    } as AxiosError;

    const outbox = {
      id: 'out-2',
      paymentDetailId: 'detail-2',
      rideId: 'ride-2',
      requestPayload: {},
      status: PaymentOutboxStatus.Pending,
    } as any;
    const paymentDetail = {
      id: 'detail-2',
      status: ERidePaymentDetailStatus.PENDING,
    } as any;

    paymentOutboxRepository.findById.mockResolvedValue(outbox);
    ridePaymentDetailRepository.findById.mockResolvedValue(paymentDetail);
    (lastValueFrom as jest.Mock).mockRejectedValue(axiosError);

    await expect(service.processOutbox(outbox.id)).rejects.toThrow(
      'Payment API request failed',
    );

    expect(paymentOutboxRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        status: PaymentOutboxStatus.Failed,
        lastError: expect.any(String),
      }),
    );
    expect(ridePaymentDetailRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: ERidePaymentDetailStatus.FAILED }),
    );
  });

  it('applies notification to payment detail and determines outbox updates', async () => {
    const paymentDetail = { id: 'detail-3' } as any;
    const payload: PaymentNotificationDto = {
      transaction_status: ERidePaymentDetailStatus.SETTLEMENT,
      order_id: 'ord-1',
      transaction_id: 'trx-1',
    } as any;

    const result = await service.applyNotification(
      ride,
      payload,
      paymentDetail,
    );

    expect(result.detail.orderId).toBe('ord-1');
    expect(result.paid).toBe(true);
    expect(result.outboxUpdate).toEqual({
      status: PaymentOutboxStatus.Completed,
      setProcessedAt: true,
      lastError: null,
    });
  });

  it('formats payment detail and handles missing values', () => {
    expect(service.formatPaymentDetail(null)).toBeNull();
    const detail = {
      id: 'id',
      provider: 'test',
      status: 'pending',
      token: undefined,
      redirectUrl: undefined,
      orderId: undefined,
      providerTransactionId: undefined,
    } as any;

    expect(service.formatPaymentDetail(detail)).toEqual({
      id: 'id',
      provider: 'test',
      status: 'pending',
      token: null,
      redirectUrl: null,
      orderId: null,
      providerTransactionId: null,
    });
  });
});
