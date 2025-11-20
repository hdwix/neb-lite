import { PaymentProcessor } from './payment.processor';
import { PaymentService, PaymentJobResult } from '../services/payment.service';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';

describe('PaymentProcessor', () => {
  let processor: PaymentProcessor;
  let paymentService: jest.Mocked<PaymentService>;

  beforeEach(() => {
    paymentService = {
      processOutbox: jest.fn(),
    } as unknown as jest.Mocked<PaymentService>;

    processor = new PaymentProcessor(paymentService);

    // Silence logger output in test; still allow spy assertions
    jest.spyOn(Logger.prototype as any, 'debug').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  const makeJob = (overrides?: Partial<Job<{ outboxId?: string }>>): Job<any> =>
    ({
      id: 'job-123',
      data: { outboxId: 'outbox-1' },
      ...overrides,
    }) as unknown as Job<{ outboxId: string }>;

  it('returns result from paymentService.processOutbox and passes correct outboxId', async () => {
    const result: PaymentJobResult = {
      paymentDetailId: 'pd-1',
      provider: 'XPay',
      status: 'SUCCESS',
      raw: { ok: true },
    } as any;

    paymentService.processOutbox.mockResolvedValue(result);

    const job = makeJob({ id: 'job-abc', data: { outboxId: 'ob-42' } });

    const ret = await processor.process(job);

    expect(paymentService.processOutbox).toHaveBeenCalledTimes(1);
    expect(paymentService.processOutbox).toHaveBeenCalledWith('ob-42');
    expect(ret).toBe(result);
  });

  it('logs the job id via Logger.debug', async () => {
    const debugSpy = jest.spyOn(Logger.prototype as any, 'debug');
    paymentService.processOutbox.mockResolvedValue({} as any);

    const job = makeJob({ id: 'job-log-1', data: { outboxId: 'ob-log' } });
    await processor.process(job);

    expect(debugSpy).toHaveBeenCalled();
    // message contains both "Processing payment outbox job" and job id
    const logged = debugSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(logged).toContain('Processing payment outbox job');
    expect(logged).toContain('job-log-1');
  });

  it('propagates errors from paymentService.processOutbox', async () => {
    const err = new Error('boom');
    paymentService.processOutbox.mockRejectedValue(err);

    const job = makeJob({ id: 'job-err', data: { outboxId: 'ob-err' } });

    await expect(processor.process(job)).rejects.toBe(err);
    expect(paymentService.processOutbox).toHaveBeenCalledWith('ob-err');
  });

  it('passes through undefined outboxId when job.data.outboxId is missing', async () => {
    paymentService.processOutbox.mockResolvedValue({} as any);

    const job = makeJob({ data: {} as any }); // no outboxId
    await processor.process(job);

    expect(paymentService.processOutbox).toHaveBeenCalledWith(undefined);
  });
});
