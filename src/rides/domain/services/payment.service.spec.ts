import { Test, TestingModule } from '@nestjs/testing';
import { PaymentService } from './payment.service';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { of, throwError } from 'rxjs';
import { BadRequestException } from '@nestjs/common';
import { AxiosError, AxiosResponse } from 'axios';
import {
  PaymentOutboxStatus,
  PaymentQueueJob,
  PAYMENT_QUEUE_NAME,
} from '../constants/payment.constants';
import { ERidePaymentDetailStatus } from '../constants/ride-payment-detail-status.enum';
import { RidePaymentDetailRepository } from '../../infrastructure/repositories/ride-payment-detail.repository';
import { PaymentOutboxRepository } from '../../infrastructure/repositories/payment-outbox.repository';
import { Queue } from 'bullmq';
import { getQueueToken } from '@nestjs/bullmq';

// --- minimal fakes / shapes used in tests
type AnyObj = Record<string, any>;

const makeAxiosError = (
  status = 502,
  data: any = { reason: 'bad gw' },
): AxiosError => {
  const err: Partial<AxiosError> = {
    isAxiosError: true,
    response: { status, data } as any,
    toJSON: () => ({}),
    name: 'AxiosError',
    message: 'axios boom',
  };
  return err as AxiosError;
};

describe('PaymentService', () => {
  let service: PaymentService;

  // Mocks
  const configMock = {
    get: jest.fn(),
  } as unknown as jest.Mocked<ConfigService>;

  const httpMock = {
    post: jest.fn(),
  } as unknown as jest.Mocked<HttpService>;

  // repositories
  const paymentDetailRepoMock = {
    findByRideId: jest.fn(),
    findById: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
  };

  const outboxRepoMock = {
    saveDetailAndOutbox: jest.fn(),
    save: jest.fn(),
    findById: jest.fn(),
  };

  // queue + job
  const fakeJob = () => {
    const job: AnyObj = {
      id: 'job-1',
      name: PaymentQueueJob.InitiatePayment,
      waitUntilFinished: jest.fn(),
    };
    return job;
  };

  const queueMock = {
    name: PAYMENT_QUEUE_NAME,
    opts: { connection: {} },
    add: jest.fn(),
  };

  beforeEach(async () => {
    jest.resetAllMocks();

    // default good config
    (configMock.get as any) = jest.fn((key: string) => {
      switch (key) {
        case 'PAYMENT_API_URL':
          return 'https://pay.example/api';
        case 'PAYMENT_API_KEY':
          return 'apiKeyBase64==';
        case 'PAYMENT_PROVIDER':
          return 'midtrans-like';
        default:
          return undefined;
      }
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentService,
        { provide: ConfigService, useValue: configMock },
        { provide: HttpService, useValue: httpMock },
        {
          provide: RidePaymentDetailRepository,
          useValue: paymentDetailRepoMock,
        },
        { provide: PaymentOutboxRepository, useValue: outboxRepoMock },
        // ✅ correct
        { provide: getQueueToken(PAYMENT_QUEUE_NAME), useValue: queueMock },
      ],
    }).compile();

    service = module.get(PaymentService);
  });

  //
  // ensurePaymentConfiguration (via methods that call it)
  //
  describe('configuration guard', () => {
    it('throws if payment configuration is missing', async () => {
      (configMock.get as any) = jest.fn(() => null); // all nulls
      const localModule = await Test.createTestingModule({
        providers: [
          PaymentService,
          { provide: ConfigService, useValue: configMock },
          { provide: HttpService, useValue: httpMock },
          {
            provide: RidePaymentDetailRepository,
            useValue: paymentDetailRepoMock,
          },
          { provide: PaymentOutboxRepository, useValue: outboxRepoMock },
          { provide: getQueueToken(PAYMENT_QUEUE_NAME), useValue: queueMock },
        ],
      }).compile();
      const s = localModule.get(PaymentService);

      await expect(s.processOutbox('id-1')).rejects.toThrow(
        BadRequestException,
      );

      await expect(
        s.initiatePayment({ id: 'r1', riderId: 'u1', fareFinal: '100' } as any),
      ).rejects.toThrow(BadRequestException);
    });
  });

  //
  // initiatePayment
  //
  describe('initiatePayment', () => {
    const ride = {
      id: 'ride-1',
      riderId: 'r-01',
      fareFinal: '12500.49',
    } as any;

    const detailBase = {
      id: 'detail-1',
      rideId: 'ride-1',
      provider: 'midtrans-like',
      status: ERidePaymentDetailStatus.PENDING,
      token: null,
      redirectUrl: null,
      orderId: null,
      requestPayload: null,
      responsePayload: null,
    };

    const outboxBase = {
      id: 'outbox-1',
      rideId: 'ride-1',
      paymentDetailId: 'detail-1',
      requestPayload: { hello: 'world' },
      status: PaymentOutboxStatus.Pending,
      attempts: 0,
      jobId: null,
      processedAt: null,
      lastError: null,
      orderId: 'ORD-1',
    };

    it('early-returns existing payment detail with token & redirect', async () => {
      const existing = {
        ...detailBase,
        token: 'tok',
        redirectUrl: 'https://redirect',
      };
      paymentDetailRepoMock.findByRideId.mockResolvedValue(existing);

      const result = await service.initiatePayment(ride);
      expect(result).toBe(existing);
      expect(paymentDetailRepoMock.create).not.toHaveBeenCalled();
    });

    it('creates detail, enqueues job, waits, returns refreshed detail (happy path)', async () => {
      paymentDetailRepoMock.findByRideId.mockResolvedValue(null);
      paymentDetailRepoMock.create.mockReturnValue({ ...detailBase });
      outboxRepoMock.saveDetailAndOutbox.mockResolvedValue({
        detail: { ...detailBase },
        outbox: { ...outboxBase, id: 'outbox-xyz' },
      });

      const job = fakeJob();
      queueMock.add.mockResolvedValue(job as any);

      // stub queueEvents
      const close = jest.fn().mockResolvedValue(undefined);
      jest
        .spyOn<any, any>(service as any, 'createQueueEvents')
        .mockResolvedValue({ close });

      // job finishes ok
      (job.waitUntilFinished as jest.Mock).mockResolvedValueOnce(undefined);

      // refreshed detail has redirect
      paymentDetailRepoMock.findById.mockResolvedValue({
        ...detailBase,
        redirectUrl: 'https://go',
        token: 'tok',
      });

      const res = await service.initiatePayment(ride);
      expect(queueMock.add).toHaveBeenCalledWith(
        PaymentQueueJob.InitiatePayment,
        { outboxId: 'outbox-xyz' },
        expect.objectContaining({ attempts: expect.any(Number) }),
      );
      expect(close).toHaveBeenCalled();
      expect(res.redirectUrl).toBe('https://go');
      expect(res.token).toBe('tok');
    });

    it('throws BadRequest when job fails (waitUntilFinished rejects)', async () => {
      paymentDetailRepoMock.findByRideId.mockResolvedValue(null);
      paymentDetailRepoMock.create.mockReturnValue({ ...detailBase });
      outboxRepoMock.saveDetailAndOutbox.mockResolvedValue({
        detail: { ...detailBase },
        outbox: { ...outboxBase, id: 'outbox-fail' },
      });

      const job = fakeJob();
      queueMock.add.mockResolvedValue(job as any);

      const close = jest.fn().mockResolvedValue(undefined);
      jest
        .spyOn<any, any>(service as any, 'createQueueEvents')
        .mockResolvedValue({ close });

      (job.waitUntilFinished as jest.Mock).mockRejectedValueOnce(
        new Error('boom'),
      );

      await expect(service.initiatePayment(ride)).rejects.toThrow(
        BadRequestException,
      );
      expect(close).toHaveBeenCalled();
    });

    it('throws when refreshed detail is missing after job success', async () => {
      paymentDetailRepoMock.findByRideId.mockResolvedValue(null);
      paymentDetailRepoMock.create.mockReturnValue({ ...detailBase });
      outboxRepoMock.saveDetailAndOutbox.mockResolvedValue({
        detail: { ...detailBase },
        outbox: { ...outboxBase, id: 'outbox-2' },
      });

      const job = fakeJob();
      queueMock.add.mockResolvedValue(job as any);

      const close = jest.fn().mockResolvedValue(undefined);
      jest
        .spyOn<any, any>(service as any, 'createQueueEvents')
        .mockResolvedValue({ close });

      (job.waitUntilFinished as jest.Mock).mockResolvedValueOnce(undefined);

      paymentDetailRepoMock.findById.mockResolvedValue(null);

      await expect(service.initiatePayment(ride)).rejects.toThrow(
        new BadRequestException('Payment detail not found after processing'),
      );
    });

    it('throws when refreshed detail has no redirectUrl', async () => {
      paymentDetailRepoMock.findByRideId.mockResolvedValue(null);
      paymentDetailRepoMock.create.mockReturnValue({ ...detailBase });
      outboxRepoMock.saveDetailAndOutbox.mockResolvedValue({
        detail: { ...detailBase },
        outbox: { ...outboxBase, id: 'outbox-3' },
      });

      const job = fakeJob();
      queueMock.add.mockResolvedValue(job as any);

      const close = jest.fn().mockResolvedValue(undefined);
      jest
        .spyOn<any, any>(service as any, 'createQueueEvents')
        .mockResolvedValue({ close });

      (job.waitUntilFinished as jest.Mock).mockResolvedValueOnce(undefined);

      paymentDetailRepoMock.findById.mockResolvedValue({
        ...detailBase,
        redirectUrl: null,
      });

      await expect(service.initiatePayment(ride)).rejects.toThrow(
        new BadRequestException(
          'Payment gateway did not return a redirect URL',
        ),
      );
    });

    it('throws "Ride does not have a payable amount" when gross amount <= 0', async () => {
      // This triggers via buildPaymentRequestPayload
      const badRide = { id: 'ride-zero', riderId: 'r', fareFinal: '0' } as any;

      paymentDetailRepoMock.findByRideId.mockResolvedValue(null);
      paymentDetailRepoMock.create.mockReturnValue({ ...detailBase });

      // saveDetailAndOutbox is called **after** payload build, so it won't be reached
      await expect(service.initiatePayment(badRide)).rejects.toThrow(
        new BadRequestException('Ride does not have a payable amount'),
      );
    });
  });

  //
  // processOutbox
  //
  describe('processOutbox', () => {
    const outbox = {
      id: 'ob-1',
      rideId: 'ride-1',
      paymentDetailId: 'detail-1',
      status: PaymentOutboxStatus.Pending,
      attempts: 0,
      requestPayload: { any: 'payload' },
      orderId: 'ORDER-1',
      lastError: null,
    };

    const detail = {
      id: 'detail-1',
      rideId: 'ride-1',
      status: ERidePaymentDetailStatus.PENDING,
      provider: 'midtrans-like',
      responsePayload: null,
      requestPayload: null,
      orderId: null,
      token: null,
      redirectUrl: null,
    };

    it('throws when outbox not found', async () => {
      outboxRepoMock.findById.mockResolvedValue(null);
      await expect(service.processOutbox('missing')).rejects.toThrow(
        /not found/,
      );
    });

    it('throws when payment detail not found', async () => {
      outboxRepoMock.findById.mockResolvedValue(outbox);
      paymentDetailRepoMock.findById.mockResolvedValue(null);
      await expect(service.processOutbox(outbox.id)).rejects.toThrow(
        /not found/,
      );
    });

    it('successfully posts to payment API, updates detail and outbox, returns result', async () => {
      outboxRepoMock.findById.mockResolvedValue({ ...outbox });
      paymentDetailRepoMock.findById.mockResolvedValue({ ...detail });

      httpMock.post.mockReturnValue(
        of({
          data: { token: 't-123', redirect_url: 'https://go.pay' },
        } as unknown as AxiosResponse),
      );

      paymentDetailRepoMock.save.mockImplementation(async (d: any) => d);
      outboxRepoMock.save.mockImplementation(async (o: any) => o);

      const result = await service.processOutbox(outbox.id);

      expect(httpMock.post).toHaveBeenCalledWith(
        'https://pay.example/api',
        outbox.requestPayload,
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: expect.stringContaining('Basic'),
          }),
        }),
      );

      expect(result.paymentDetailId).toBe('detail-1');
      expect(result.token).toBe('t-123');
      expect(result.redirectUrl).toBe('https://go.pay');
    });

    it('handles axios error: sets outbox failed, detail failed, throws', async () => {
      outboxRepoMock.findById.mockResolvedValue({ ...outbox });
      paymentDetailRepoMock.findById.mockResolvedValue({ ...detail });

      httpMock.post.mockReturnValue(
        throwError(() => makeAxiosError(400, { msg: 'bad' })),
      );

      paymentDetailRepoMock.save.mockImplementation(async (d: any) => d);
      outboxRepoMock.save.mockImplementation(async (o: any) => o);

      await expect(service.processOutbox(outbox.id)).rejects.toThrow(
        /Payment API request failed/,
      );

      expect(outboxRepoMock.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: PaymentOutboxStatus.Failed }),
      );
      expect(paymentDetailRepoMock.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: ERidePaymentDetailStatus.FAILED }),
      );
    });

    it('handles non-axios error: sets failed & rethrows', async () => {
      outboxRepoMock.findById.mockResolvedValue({ ...outbox });
      paymentDetailRepoMock.findById.mockResolvedValue({ ...detail });

      httpMock.post.mockReturnValue(throwError(() => new Error('boom')));

      await expect(service.processOutbox(outbox.id)).rejects.toThrow(/boom/);
      expect(outboxRepoMock.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: PaymentOutboxStatus.Failed }),
      );
    });
  });

  //
  // applyNotification (+ helpers via status mapping)
  //
  describe('applyNotification', () => {
    const ride = { id: 'ride-10', riderId: 'r-10' } as any;
    const pd = { id: 'd-10', status: ERidePaymentDetailStatus.PENDING } as any;

    const buildPayload = (status: string): any => ({
      order_id: 'ord-1',
      transaction_status: status,
      transaction_id: 'tx-1',
    });

    it('successful statuses => paid, outbox completed', async () => {
      const statuses = [
        ERidePaymentDetailStatus.CAPTURE,
        ERidePaymentDetailStatus.SETTLEMENT,
        ERidePaymentDetailStatus.SUCCESS,
        ERidePaymentDetailStatus.COMPLETED,
      ];

      for (const s of statuses) {
        const { detail, paid, outboxUpdate } = await service.applyNotification(
          ride,
          buildPayload(s),
          { ...pd },
        );
        expect(paid).toBe(true);
        expect(detail.status).toBe(s);
        expect(outboxUpdate).toEqual({
          status: PaymentOutboxStatus.Completed,
          setProcessedAt: true,
          lastError: null,
        });
      }
    });

    it('final failure statuses => not paid, outbox failed with error', async () => {
      const statuses = [
        ERidePaymentDetailStatus.DENY,
        ERidePaymentDetailStatus.CANCEL,
        ERidePaymentDetailStatus.CANCELLED,
        ERidePaymentDetailStatus.EXPIRED,
        ERidePaymentDetailStatus.EXPIRE,
        ERidePaymentDetailStatus.FAILURE,
        ERidePaymentDetailStatus.FAILED,
      ];

      for (const s of statuses) {
        const { detail, paid, outboxUpdate } = await service.applyNotification(
          ride,
          buildPayload(s),
          { ...pd },
        );
        expect(paid).toBe(false);
        expect(detail.status).toBe(s);
        expect(outboxUpdate).toEqual({
          status: PaymentOutboxStatus.Failed,
          setProcessedAt: true,
          lastError: `Payment failed with status ${s.toLowerCase()}`,
        });
      }
    });

    it('pending statuses => not paid, outbox processing (no processedAt)', async () => {
      const statuses = [
        ERidePaymentDetailStatus.PENDING,
        ERidePaymentDetailStatus.AUTHORIZE,
        ERidePaymentDetailStatus.AUTHORIZED,
        ERidePaymentDetailStatus.CHALLENGE,
      ];

      for (const s of statuses) {
        const { detail, paid, outboxUpdate } = await service.applyNotification(
          ride,
          buildPayload(s),
          { ...pd },
        );
        expect(paid).toBe(false);
        expect(detail.status).toBe(s);
        expect(outboxUpdate).toEqual({
          status: PaymentOutboxStatus.Processing,
          setProcessedAt: false,
          lastError: null,
        });
      }
    });

    it('unknown status => not paid, outbox failed generic', async () => {
      const { detail, paid, outboxUpdate } = await service.applyNotification(
        ride,
        buildPayload('TOTALLY_UNKNOWN'),
        { ...pd },
      );
      expect(paid).toBe(false);
      expect(detail.status).toBe(ERidePaymentDetailStatus.UNKNOWN);
      expect(outboxUpdate).toEqual({
        status: PaymentOutboxStatus.Failed,
        setProcessedAt: true,
        lastError: 'Payment resulted in status unknown',
      });
    });

    it('formatPaymentDetail returns null for null', () => {
      expect(service.formatPaymentDetail(null)).toBeNull();
    });

    it('formatPaymentDetail maps fields and nullables', () => {
      const detail = {
        id: 'x',
        provider: 'mid',
        status: ERidePaymentDetailStatus.PENDING,
        token: null,
        redirectUrl: null,
        orderId: null,
        providerTransactionId: null,
      } as any;
      expect(service.formatPaymentDetail(detail)).toEqual({
        id: 'x',
        provider: 'mid',
        status: ERidePaymentDetailStatus.PENDING,
        token: null,
        redirectUrl: null,
        orderId: null,
        providerTransactionId: null,
      });
    });
  });
});
