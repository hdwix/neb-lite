jest.mock('rxjs', () => ({
  lastValueFrom: jest.fn(),
}));

import { BadRequestException, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { lastValueFrom } from 'rxjs';
import { RidesManagementService } from './rides-management.service';
import { FareEngineService } from './fare-engine.service';
import { RideNotificationService } from './ride-notification.service';
import { RideRepository } from '../../infrastructure/repositories/ride.repository';
import { RideStatusHistoryRepository } from '../../infrastructure/repositories/ride-status-history.repository';
import { RideDriverCandidateRepository } from '../../infrastructure/repositories/ride-driver-candidate.repository';
import { LocationService } from '../../../location/domain/services/location.service';
import { Queue } from 'bullmq';

const mockQueue = {
  name: 'ride-queue',
  opts: { connection: {} },
} as unknown as Queue;

const buildService = (overrides: Partial<ConfigService> = {}) => {
  const configService = {
    get: jest.fn((key: string) => {
      const values: Record<string, string> = {
        ORS_URL: 'https://ors.example.com',
        ORS_APIKEY: 'apikey',
      };
      return (overrides.get as any)?.(key) ?? values[key];
    }),
  } as unknown as jest.Mocked<ConfigService>;

  const httpService = {
    get: jest.fn(),
  } as unknown as jest.Mocked<HttpService>;

  const rideRepository = {} as RideRepository;
  const rideStatusHistoryRepository = {} as RideStatusHistoryRepository;
  const notificationService = {} as RideNotificationService;
  const candidateRepository = {} as RideDriverCandidateRepository;
  const locationService = {} as LocationService;
  const fareEngine = {
    calculateEstimatedFare: jest.fn(),
  } as unknown as FareEngineService;

  const service = new RidesManagementService(
    mockQueue,
    rideRepository,
    rideStatusHistoryRepository,
    notificationService,
    candidateRepository,
    locationService,
    httpService,
    fareEngine,
    configService,
  );

  return { service, httpService, configService, fareEngine };
};

describe('RidesManagementService', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('fetches route estimates by parsing summary response', async () => {
    const payload = {
      features: [
        {
          properties: { summary: { distance: 1200, duration: 90 } },
        },
      ],
    };

    const { service, httpService, configService } = buildService();
    (lastValueFrom as jest.Mock).mockResolvedValue({ data: payload });

    const result = await service.fetchRouteEstimates(
      { longitude: 1, latitude: 2 },
      { longitude: 3, latitude: 4 },
    );

    expect(httpService.get).toHaveBeenCalledWith(
      expect.stringContaining('https://ors.example.com'),
      expect.objectContaining({ headers: expect.any(Object) }),
    );
    expect(configService.get).toHaveBeenCalledWith('ORS_URL');
    expect(result).toEqual({ distanceKm: 1.2, durationSeconds: 90 });
  });

  it('throws descriptive errors for missing ORS configuration and parsing issues', async () => {
    const warnSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const { service: misconfiguredService, configService: missingConfig } =
      buildService();
    missingConfig.get.mockImplementation((key: string) => {
      if (key === 'ORS_URL') {
        return undefined;
      }
      return undefined;
    });

    await expect(
      misconfiguredService.fetchRouteEstimates(
        { longitude: 1, latitude: 2 },
        { longitude: 3, latitude: 4 },
      ),
    ).rejects.toThrow('Missing configuration for ORS_URL');
    expect(warnSpy).not.toHaveBeenCalled();

    const { service, httpService } = buildService();
    (lastValueFrom as jest.Mock).mockResolvedValue({ data: {} });

    await expect(
      service.fetchRouteEstimates(
        { longitude: 0, latitude: 0 },
        { longitude: 1, latitude: 1 },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('wraps axios errors when requesting route summaries', async () => {
    const error = {
      isAxiosError: true,
      message: 'boom',
      response: { status: 500, statusText: 'err' },
    } as any;
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();

    const { service, httpService } = buildService();
    (lastValueFrom as jest.Mock).mockRejectedValue(error);

    await expect(
      service.fetchRouteEstimates(
        { longitude: 1, latitude: 2 },
        { longitude: 3, latitude: 4 },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(errorSpy).toHaveBeenCalled();
    expect(httpService.get).toHaveBeenCalled();
  });
});
