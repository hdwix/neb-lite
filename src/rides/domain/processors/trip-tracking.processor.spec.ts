import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { TripTrackingProcessor } from './trip-tracking.processor';
import {
  TRIP_TRACKING_QUEUE_NAME,
  TripTrackingQueueJob,
  TripTrackingJobData,
} from '../constants/trip-tracking.constants';
import { TripTrackingService } from '../services/trip-tracking.service';

describe('TripTrackingProcessor', () => {
  let processor: TripTrackingProcessor;
  let service: jest.Mocked<TripTrackingService>;
  let debugSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    service = {
      flushAll: jest.fn(),
      flushRide: jest.fn(),
    } as unknown as jest.Mocked<TripTrackingService>;

    processor = new TripTrackingProcessor(service);

    // silence Logger output while allowing assertions
    debugSpy = jest
      .spyOn(Logger.prototype as any, 'debug')
      .mockImplementation(() => {});
    warnSpy = jest
      .spyOn(Logger.prototype as any, 'warn')
      .mockImplementation(() => {});
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  const makeJob = <T extends TripTrackingJobData>(
    name: string,
    data: Partial<T> = {},
    overrides: Partial<Job<T>> = {},
  ): Job<T> =>
    ({
      id: 'job-1',
      name,
      data: data as T,
      queueName: TRIP_TRACKING_QUEUE_NAME,
      ...overrides,
    }) as unknown as Job<T>;

  describe('process()', () => {
    it('handles FlushAll: logs and calls flushAll', async () => {
      const job = makeJob(
        TripTrackingQueueJob.FlushAll,
        {},
        { id: 'flush-all-007' },
      );

      await processor.process(job);

      expect(service.flushAll).toHaveBeenCalledTimes(1);
      expect(debugSpy).toHaveBeenCalled();
      const messages = debugSpy.mock.calls.map((c) => String(c[0])).join('\n');
      expect(messages).toContain(
        'Processing trip tracking flush-all job flush-all-007',
      );
    });

    it('propagates errors from flushAll', async () => {
      const job = makeJob(TripTrackingQueueJob.FlushAll);
      const err = new Error('flush-all-failed');
      service.flushAll.mockRejectedValueOnce(err);

      await expect(processor.process(job)).rejects.toBe(err);
      expect(service.flushAll).toHaveBeenCalledTimes(1);
    });

    it('handles FlushRide with rideId: logs and calls flushRide(id)', async () => {
      const job = makeJob<{ rideId: string }>(
        TripTrackingQueueJob.FlushRide,
        { rideId: 'ride-42' },
        { id: 'flush-ride-123' },
      );

      await processor.process(job);

      expect(service.flushRide).toHaveBeenCalledTimes(1);
      expect(service.flushRide).toHaveBeenCalledWith('ride-42');

      const messages = debugSpy.mock.calls.map((c) => String(c[0])).join('\n');
      expect(messages).toContain(
        'Processing trip tracking flush-ride job flush-ride-123 for ride-42',
      );
    });

    it('propagates errors from flushRide', async () => {
      const job = makeJob<{ rideId: string }>(TripTrackingQueueJob.FlushRide, {
        rideId: 'ride-x',
      });
      const err = new Error('flush-ride-failed');
      service.flushRide.mockRejectedValueOnce(err);

      await expect(processor.process(job)).rejects.toBe(err);
      expect(service.flushRide).toHaveBeenCalledWith('ride-x');
    });

    it('handles FlushRide without rideId: warns and does not call flushRide', async () => {
      const job = makeJob(TripTrackingQueueJob.FlushRide, {}); // no rideId

      await processor.process(job);

      expect(service.flushRide).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalled();
      const warnMessage = String(warnSpy.mock.calls[0][0]);
      expect(warnMessage).toContain('Received flush-ride job without rideId');
    });

    it('logs a warning for unknown job names and does nothing', async () => {
      const job = makeJob('SomeUnknownJob', {}, { id: 'unknown-1' });

      await processor.process(job);

      expect(service.flushAll).not.toHaveBeenCalled();
      expect(service.flushRide).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalled();
      const warnMessage = String(warnSpy.mock.calls[0][0]);
      expect(warnMessage).toContain(
        'Received unknown trip tracking job: SomeUnknownJob',
      );
    });
  });
});
