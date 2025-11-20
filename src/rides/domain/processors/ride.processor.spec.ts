import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { RideProcessor } from './ride.processor';
import {
  RIDE_QUEUE_NAME,
  RideQueueJob,
  RideRouteEstimationJobData,
} from '../types/ride-queue.types';
import {
  RidesManagementService,
  RouteEstimates,
} from '../services/rides-management.service';

describe('RideProcessor', () => {
  let processor: RideProcessor;
  let ridesManagementService: jest.Mocked<RidesManagementService>;

  beforeEach(() => {
    ridesManagementService = {
      fetchRouteEstimates: jest.fn(),
    } as unknown as jest.Mocked<RidesManagementService>;

    processor = new RideProcessor(ridesManagementService);

    // Silence real logging but keep spies working
    jest.spyOn(Logger.prototype as any, 'debug').mockImplementation(() => {});
    jest.spyOn(Logger.prototype as any, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  const makeEstimateJob = (
    data: Partial<RideRouteEstimationJobData> = {},
    overrides?: Partial<Job<RideRouteEstimationJobData>>,
  ): Job<RideRouteEstimationJobData> =>
    ({
      id: 'job-1',
      name: RideQueueJob.EstimateRoute,
      data: {
        rideId: 'ride-123',
        pickup: { coordinate: { longitude: 106.8, latitude: -6.2 } },
        dropoff: { coordinate: { longitude: 106.9, latitude: -6.3 } },
        ...data,
      } as RideRouteEstimationJobData,
      queueName: RIDE_QUEUE_NAME,
      ...overrides,
    }) as unknown as Job<RideRouteEstimationJobData>;

  it('calls fetchRouteEstimates and returns its result for EstimateRoute job', async () => {
    const expected: RouteEstimates = {
      distanceKm: 12.34,
      durationSeconds: 900,
      fareEstimated: 37000,
      polylineEncoded: 'abc123',
    } as any;

    ridesManagementService.fetchRouteEstimates.mockResolvedValue(expected);

    const job = makeEstimateJob(undefined, { id: 'job-est-42' });
    const result = await processor.process(job);

    expect(ridesManagementService.fetchRouteEstimates).toHaveBeenCalledTimes(1);
    expect(ridesManagementService.fetchRouteEstimates).toHaveBeenCalledWith(
      job.data.pickup,
      job.data.dropoff,
    );
    expect(result).toBe(expected);
  });

  it('logs a debug message including the ride id when estimating route', async () => {
    ridesManagementService.fetchRouteEstimates.mockResolvedValue({} as any);
    const debugSpy = jest.spyOn(Logger.prototype as any, 'debug');

    const job = makeEstimateJob({ rideId: 'ride-xyz' }, { id: 'job-log' });
    await processor.process(job);

    const logged = debugSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(logged).toContain('Estimating route for ride ride-xyz');
  });

  it('propagates errors thrown by fetchRouteEstimates', async () => {
    const err = new Error('routing failed');
    ridesManagementService.fetchRouteEstimates.mockRejectedValue(err);

    const job = makeEstimateJob();

    await expect(processor.process(job)).rejects.toBe(err);
    expect(ridesManagementService.fetchRouteEstimates).toHaveBeenCalled();
  });

  it('logs a warning and returns undefined for unknown job names', async () => {
    const warnSpy = jest.spyOn(Logger.prototype as any, 'warn');

    const job = {
      id: 'job-unknown',
      name: 'TotallyUnknownJob',
      data: {} as any,
      queueName: RIDE_QUEUE_NAME,
    } as unknown as Job<any>;

    const result = await processor.process(job);

    expect(result).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const message = String(warnSpy.mock.calls[0][0]);
    expect(message).toContain('Received unknown ride job');
    expect(message).toContain('TotallyUnknownJob');
    // Also ensure service was not touched
    expect(ridesManagementService.fetchRouteEstimates).not.toHaveBeenCalled();
  });
});
