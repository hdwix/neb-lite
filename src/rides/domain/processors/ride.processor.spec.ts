import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { RideProcessor } from './ride.processor';
import { RidesManagementService } from '../services/rides-management.service';
import { RideQueueJob, RideRouteEstimationJobData } from '../types/ride-queue.types';

describe('RideProcessor', () => {
  let processor: RideProcessor;
  let ridesManagementService: jest.Mocked<RidesManagementService>;

  beforeEach(() => {
    ridesManagementService = {
      fetchRouteEstimates: jest.fn(),
    } as unknown as jest.Mocked<RidesManagementService>;

    processor = new RideProcessor(ridesManagementService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('delegates route estimation jobs to management service', async () => {
    const debugSpy = jest.spyOn(Logger.prototype, 'debug').mockImplementation();
    const job = {
      name: RideQueueJob.EstimateRoute,
      data: {
        rideId: 'ride-1',
        pickup: { longitude: 1, latitude: 2 },
        dropoff: { longitude: 3, latitude: 4 },
      } as RideRouteEstimationJobData,
    } as Job<RideRouteEstimationJobData>;

    ridesManagementService.fetchRouteEstimates.mockResolvedValueOnce({
      distanceKm: 12,
      durationSeconds: 600,
    });

    const result = await processor.process(job);

    expect(ridesManagementService.fetchRouteEstimates).toHaveBeenCalledWith(
      { longitude: 1, latitude: 2 },
      { longitude: 3, latitude: 4 },
    );
    expect(result).toEqual({ distanceKm: 12, durationSeconds: 600 });
    expect(debugSpy).toHaveBeenCalledWith('Estimating route for ride ride-1');
  });

  it('logs a warning for unknown job types', async () => {
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const job = {
      name: 'UnknownJob',
      data: {},
    } as Job<any>;

    const result = await processor.process(job);

    expect(result).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith('Received unknown ride job UnknownJob');
  });
});
