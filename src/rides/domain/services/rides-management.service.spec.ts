import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { Queue } from 'bullmq';
import { RidesManagementService } from './rides-management.service';
import { RideRepository } from '../../infrastructure/repositories/ride.repository';
import { RideStatusHistoryRepository } from '../../infrastructure/repositories/ride-status-history.repository';
import { RideNotificationService } from './ride-notification.service';
import { LocationService } from '../../../location/domain/services/location.service';
import { RideDriverCandidateRepository } from '../../infrastructure/repositories/ride-driver-candidate.repository';
import { HttpService } from '@nestjs/axios';
import { FareEngineService } from './fare-engine.service';
import { ConfigService } from '@nestjs/config';
import { ERideStatus } from '../constants/ride-status.enum';
import { ERideDriverCandidateStatus } from '../constants/ride-driver-candidate-status.enum';
import { RIDE_QUEUE_NAME, RideQueueJobData } from '../types/ride-queue.types';
import { getQueueToken } from '@nestjs/bullmq';
import { EClientType } from '../../../app/enums/client-type.enum';

type AnyObj = Record<string, any>;

describe('RidesManagementService.createRide', () => {
  let service: RidesManagementService;

  // dependencies
  let rideQueue: jest.Mocked<Queue<RideQueueJobData>>;
  let rideRepository: {
    findUnfinishedRideByRiderId: jest.Mock;
    createRideWithDetails: jest.Mock;
  };
  let rideStatusHistoryRepository: any;
  let notificationService: {
    notifyRideOffered: jest.Mock;
    notifyRideMatched: jest.Mock;
  };
  let candidateRepository: any;
  let locationService: { getNearbyDrivers: jest.Mock };
  let httpService: any;
  let fareEngine: { calculateEstimatedFare: jest.Mock };
  let configService: any;

  const FIXED_NOW = 1700000000000; // stable Date.now()
  const riderId = 'r-1';
  const pickup = { longitude: 106.8, latitude: -6.2 };
  const dropoff = { longitude: 106.9, latitude: -6.15 };

  beforeEach(async () => {
    jest.spyOn(Date, 'now').mockReturnValue(FIXED_NOW);

    rideQueue = {
      name: RIDE_QUEUE_NAME,
      opts: { connection: {} },
      add: jest.fn(),
      remove: jest.fn().mockResolvedValue(undefined),
    } as any;

    rideRepository = {
      findUnfinishedRideByRiderId: jest.fn(),
      createRideWithDetails: jest.fn(),
    };

    rideStatusHistoryRepository = {};

    notificationService = {
      notifyRideOffered: jest.fn().mockResolvedValue(undefined),
      notifyRideMatched: jest.fn().mockResolvedValue(undefined),
    };

    candidateRepository = {};

    locationService = {
      getNearbyDrivers: jest.fn(),
    };

    httpService = {};
    fareEngine = {
      calculateEstimatedFare: jest.fn().mockReturnValue('9000.00'),
    };
    configService = { get: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RidesManagementService,
        { provide: getQueueToken(RIDE_QUEUE_NAME), useValue: rideQueue }, // @InjectQueue(RIDE_QUEUE_NAME)
        { provide: RideRepository, useValue: rideRepository },
        {
          provide: RideStatusHistoryRepository,
          useValue: rideStatusHistoryRepository,
        },
        { provide: RideNotificationService, useValue: notificationService },
        {
          provide: RideDriverCandidateRepository,
          useValue: candidateRepository,
        },
        { provide: LocationService, useValue: locationService },
        { provide: HttpService, useValue: httpService },
        { provide: FareEngineService, useValue: fareEngine },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get(RidesManagementService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const routeEstimates = { distanceKm: 3.0, durationSeconds: 420 };

  const nearbyDrivers = [
    { driverId: 'd-1', distanceMeters: 123.4 },
    { driverId: 'd-2', distanceMeters: 456.7 },
  ];

  const createdRide = {
    id: 'ride-xyz',
    riderId,
    status: ERideStatus.CANDIDATES_COMPUTED,
  };

  const candidates = [
    {
      rideId: 'ride-xyz',
      driverId: 'd-1',
      status: ERideDriverCandidateStatus.INVITED,
    },
    {
      rideId: 'ride-xyz',
      driverId: 'd-2',
      status: ERideDriverCandidateStatus.INVITED,
    },
  ];

  // Helper: stub the private requestRouteEstimatesThroughQueue
  const stubRouteEstimates = (impl?: () => any) =>
    jest
      .spyOn<any, any>(service as any, 'requestRouteEstimatesThroughQueue')
      .mockImplementation(impl ?? (async () => routeEstimates));

  //
  // Guard cases
  //
  it('throws BadRequest when riderId is missing', async () => {
    await expect(
      service.createRide('', { pickup, dropoff }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(rideRepository.findUnfinishedRideByRiderId).not.toHaveBeenCalled();
  });

  it('throws Conflict when an unfinished ride exists', async () => {
    rideRepository.findUnfinishedRideByRiderId.mockResolvedValue({
      id: 'ride-old',
    });
    await expect(
      service.createRide(riderId, { pickup, dropoff }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  //
  // Happy path
  //
  it('creates ride, notifies drivers & rider, and returns ride + candidates (happy path)', async () => {
    rideRepository.findUnfinishedRideByRiderId.mockResolvedValue(null);
    stubRouteEstimates();
    locationService.getNearbyDrivers.mockResolvedValue(nearbyDrivers);
    rideRepository.createRideWithDetails.mockResolvedValue({
      ride: createdRide,
      candidates,
    });

    const result = await service.createRide(riderId, {
      pickup,
      dropoff,
      note: 'bring mask',
      maxDrivers: 5,
    });

    // Makes fare estimation call with distanceKm
    expect(fareEngine.calculateEstimatedFare).toHaveBeenCalledWith(
      routeEstimates.distanceKm,
    );

    // Repo call with composed payload (shape/assertions)
    expect(rideRepository.createRideWithDetails).toHaveBeenCalledWith(
      expect.objectContaining({
        ride: expect.objectContaining({
          riderId,
          pickupLongitude: pickup.longitude,
          pickupLatitude: pickup.latitude,
          dropoffLongitude: dropoff.longitude,
          dropoffLatitude: dropoff.latitude,
          note: 'bring mask',
          status: ERideStatus.CANDIDATES_COMPUTED,
          fareEstimated: '9000.00',
          distanceEstimatedKm: routeEstimates.distanceKm,
          durationEstimatedSeconds: routeEstimates.durationSeconds,
        }),
        nearbyDrivers,
        historyEntries: expect.any(Array),
      }),
    );

    // Notifications: one per candidate + matched
    expect(notificationService.notifyRideOffered).toHaveBeenCalledTimes(
      candidates.length,
    );
    expect(notificationService.notifyRideOffered).toHaveBeenNthCalledWith(
      1,
      createdRide,
      candidates[0],
      routeEstimates,
    );
    expect(notificationService.notifyRideOffered).toHaveBeenNthCalledWith(
      2,
      createdRide,
      candidates[1],
      routeEstimates,
    );
    expect(notificationService.notifyRideMatched).toHaveBeenCalledWith(
      createdRide,
    );

    // Return value
    expect(result).toEqual({ ride: createdRide, candidates });
  });

  //
  // No nearby drivers
  //
  it('propagates "unable to find driver" error when no nearby drivers', async () => {
    rideRepository.findUnfinishedRideByRiderId.mockResolvedValue(null);
    stubRouteEstimates();
    locationService.getNearbyDrivers.mockResolvedValue([]);

    // Should throw exactly the same error message (and not wrap)
    await expect(
      service.createRide(riderId, { pickup, dropoff }),
    ).rejects.toThrow('unable to find driver, try again later');

    // The catch cleanup should attempt to remove the route job
    expect(rideQueue.remove).toHaveBeenCalledWith(
      `ride-request-${riderId}-${FIXED_NOW}-route-estimation`,
    );
  });

  //
  // Route estimation throws BadRequest -> rethrow as-is
  //
  it('rethrows BadRequestException from route estimation', async () => {
    rideRepository.findUnfinishedRideByRiderId.mockResolvedValue(null);
    stubRouteEstimates(async () => {
      throw new BadRequestException('ORS bad');
    });

    await expect(
      service.createRide(riderId, { pickup, dropoff }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(rideQueue.remove).toHaveBeenCalledWith(
      `ride-request-${riderId}-${FIXED_NOW}-route-estimation`,
    );
    expect(locationService.getNearbyDrivers).not.toHaveBeenCalled();
  });

  //
  // Unknown/axios-like error -> InternalServerErrorException
  //
  it('wraps axios-like error as InternalServerErrorException and cleans up queue job', async () => {
    rideRepository.findUnfinishedRideByRiderId.mockResolvedValue(null);
    const axiosLikeError = {
      isAxiosError: true,
      message: 'network fail',
      response: { status: 502, statusText: 'Bad Gateway' },
    };
    stubRouteEstimates(async () => {
      throw axiosLikeError;
    });

    await expect(
      service.createRide(riderId, { pickup, dropoff }),
    ).rejects.toBeInstanceOf(InternalServerErrorException);

    expect(rideQueue.remove).toHaveBeenCalledWith(
      `ride-request-${riderId}-${FIXED_NOW}-route-estimation`,
    );
  });

  it('wraps generic error as InternalServerErrorException and cleans up', async () => {
    rideRepository.findUnfinishedRideByRiderId.mockResolvedValue(null);
    stubRouteEstimates(async () => {
      throw new Error('boom');
    });

    await expect(
      service.createRide(riderId, { pickup, dropoff }),
    ).rejects.toBeInstanceOf(InternalServerErrorException);

    expect(rideQueue.remove).toHaveBeenCalledWith(
      `ride-request-${riderId}-${FIXED_NOW}-route-estimation`,
    );
  });

  //
  // Candidate limit behavior passed to getNearbyDrivers
  //
  it('uses default/capped candidate limit when maxDrivers omitted or > 50', async () => {
    rideRepository.findUnfinishedRideByRiderId.mockResolvedValue(null);
    stubRouteEstimates();
    locationService.getNearbyDrivers.mockResolvedValue(nearbyDrivers);
    rideRepository.createRideWithDetails.mockResolvedValue({
      ride: createdRide,
      candidates,
    });

    // Case 1: omitted -> defaults to internal default flow (resolveCandidateLimit => 20)
    await service.createRide(riderId, { pickup, dropoff });
    expect(locationService.getNearbyDrivers).toHaveBeenLastCalledWith(
      pickup.longitude,
      pickup.latitude,
      20,
    );

    // Case 2: > 50 -> capped to 20
    await service.createRide(riderId, { pickup, dropoff, maxDrivers: 99 });
    expect(locationService.getNearbyDrivers).toHaveBeenLastCalledWith(
      pickup.longitude,
      pickup.latitude,
      20,
    );
  });

  it('passes small requested candidate limit to getNearbyDrivers', async () => {
    rideRepository.findUnfinishedRideByRiderId.mockResolvedValue(null);
    stubRouteEstimates();
    locationService.getNearbyDrivers.mockResolvedValue(nearbyDrivers);
    rideRepository.createRideWithDetails.mockResolvedValue({
      ride: createdRide,
      candidates,
    });

    await service.createRide(riderId, { pickup, dropoff, maxDrivers: 5 });
    expect(locationService.getNearbyDrivers).toHaveBeenLastCalledWith(
      pickup.longitude,
      pickup.latitude,
      5,
    );
  });
});

describe('RidesManagementService.cancelRide', () => {
  let service: RidesManagementService;

  // Mocks for dependencies
  let rideQueue: jest.Mocked<Queue<RideQueueJobData>>;
  let rideRepository: {
    findById: jest.Mock;
    updateRide: jest.Mock;
    createRideWithDetails?: jest.Mock;
    claimDriver?: jest.Mock;
  };
  let rideStatusHistoryRepository: any;
  let notificationService: { notifyRideCanceledForCandidate: jest.Mock };
  let candidateRepository: {
    findByRideId: jest.Mock;
    saveMany: jest.Mock;
  };
  let locationService: any;
  let httpService: any;
  let fareEngine: any;
  let configService: any;

  const makeRide = (over: Partial<any> = {}) => ({
    id: over.id ?? 'ride-1',
    riderId: over.riderId ?? 'r-1',
    driverId: over.driverId ?? 'd-1',
    status: over.status ?? ERideStatus.CANDIDATES_COMPUTED,
    cancelReason: over.cancelReason ?? undefined,
    fareFinal: over.fareFinal ?? undefined,
  });

  const makeCandidate = (over: Partial<any> = {}) => ({
    driverId: over.driverId ?? 'd-x',
    status: over.status ?? ERideDriverCandidateStatus.INVITED,
    reason: over.reason ?? null,
    respondedAt: over.respondedAt ?? null,
  });

  beforeEach(async () => {
    jest.useFakeTimers().setSystemTime(new Date('2025-01-01T00:00:00Z'));

    rideQueue = {
      name: RIDE_QUEUE_NAME,
      opts: { connection: {} },
      remove: jest.fn(),
    } as any;

    rideRepository = {
      findById: jest.fn(),
      updateRide: jest.fn(),
    };

    rideStatusHistoryRepository = {
      create: jest.fn(),
      save: jest.fn(),
    };

    notificationService = {
      notifyRideCanceledForCandidate: jest.fn().mockResolvedValue(undefined),
    };

    candidateRepository = {
      findByRideId: jest.fn(),
      saveMany: jest.fn(),
    };

    locationService = {};
    httpService = {};
    fareEngine = {};
    configService = { get: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RidesManagementService,
        { provide: getQueueToken(RIDE_QUEUE_NAME), useValue: rideQueue },
        { provide: RideRepository, useValue: rideRepository },
        {
          provide: RideStatusHistoryRepository,
          useValue: rideStatusHistoryRepository,
        },
        { provide: RideNotificationService, useValue: notificationService },
        {
          provide: RideDriverCandidateRepository,
          useValue: candidateRepository,
        },
        { provide: LocationService, useValue: locationService },
        { provide: HttpService, useValue: httpService },
        { provide: FareEngineService, useValue: fareEngine },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get(RidesManagementService);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('throws NotFound when ride does not exist', async () => {
    rideRepository.findById.mockResolvedValue(null);

    await expect(
      service.cancelRide('missing', { id: 'r-1', role: EClientType.RIDER }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws NotFound when requester is not the rider', async () => {
    const ride = makeRide({ riderId: 'r-actual' });
    rideRepository.findById.mockResolvedValue(ride);

    await expect(
      service.cancelRide('ride-1', { id: 'r-other', role: EClientType.RIDER }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws BadRequest when ride is COMPLETED', async () => {
    const ride = makeRide({ riderId: 'r-1', status: ERideStatus.COMPLETED });
    rideRepository.findById.mockResolvedValue(ride);

    await expect(
      service.cancelRide('ride-1', { id: 'r-1', role: EClientType.RIDER }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('returns ride as-is when already CANCELED (no side effects)', async () => {
    const ride = makeRide({ riderId: 'r-1', status: ERideStatus.CANCELED });
    rideRepository.findById.mockResolvedValue(ride);

    const removeSpy = jest.spyOn<any, any>(service as any, 'removePendingJobs');
    const transitionSpy = jest.spyOn<any, any>(
      service as any,
      'transitionRideStatus',
    );

    const res = await service.cancelRide('ride-1', {
      id: 'r-1',
      role: EClientType.RIDER,
    });

    expect(res).toBe(ride);
    expect(removeSpy).not.toHaveBeenCalled();
    expect(transitionSpy).not.toHaveBeenCalled();
    expect(candidateRepository.findByRideId).not.toHaveBeenCalled();
    expect(candidateRepository.saveMany).not.toHaveBeenCalled();
    expect(
      notificationService.notifyRideCanceledForCandidate,
    ).not.toHaveBeenCalled();
  });

  it('cancels ride with explicit reason, updates candidates & notifies, returns refreshed ride', async () => {
    const ride = makeRide({ riderId: 'r-1', status: ERideStatus.ASSIGNED });
    const updated = makeRide({
      ...ride,
      status: ERideStatus.CANCELED,
      cancelReason: 'rain',
    });
    const refreshed = { ...updated, fareFinal: '0.00' };

    rideRepository.findById
      .mockResolvedValueOnce(ride) // initial read
      .mockResolvedValueOnce(refreshed); // refreshed at the end

    const removeSpy = jest
      .spyOn<any, any>(service as any, 'removePendingJobs')
      .mockResolvedValue(undefined);

    const transitionSpy = jest
      .spyOn<any, any>(service as any, 'transitionRideStatus')
      .mockResolvedValue({ ride: { ...updated }, changed: true });

    // 3 candidates: one already canceled (skip), two to update
    const cand1 = makeCandidate({
      driverId: 'd-1',
      status: ERideDriverCandidateStatus.INVITED,
    });
    const cand2 = makeCandidate({
      driverId: 'd-2',
      status: ERideDriverCandidateStatus.ACCEPTED,
    });
    const cand3 = makeCandidate({
      driverId: 'd-3',
      status: ERideDriverCandidateStatus.CANCELED,
    });
    candidateRepository.findByRideId.mockResolvedValue([cand1, cand2, cand3]);
    candidateRepository.saveMany.mockImplementation(async (arr) => arr);

    rideRepository.updateRide.mockImplementation(async (r) => r);

    const result = await service.cancelRide(
      'ride-1',
      { id: 'r-1', role: EClientType.RIDER },
      { reason: 'rain' },
    );

    // remove pending jobs + transition
    expect(removeSpy).toHaveBeenCalledWith('ride-1');
    expect(transitionSpy).toHaveBeenCalledWith(
      'ride-1',
      [
        ERideStatus.REQUESTED,
        ERideStatus.CANDIDATES_COMPUTED,
        ERideStatus.ASSIGNED,
        ERideStatus.ACCEPTED,
        ERideStatus.ENROUTE,
      ],
      ERideStatus.CANCELED,
      'rain',
    );

    // updated fields
    expect(rideRepository.updateRide).toHaveBeenCalledWith(
      expect.objectContaining({
        fareFinal: '0.00',
        cancelReason: 'rain',
        status: ERideStatus.CANCELED,
      }),
    );

    // candidates saved (only non-canceled)
    expect(candidateRepository.saveMany).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          driverId: 'd-1',
          status: ERideDriverCandidateStatus.CANCELED,
          reason: 'rain',
        }),
        expect.objectContaining({
          driverId: 'd-2',
          status: ERideDriverCandidateStatus.CANCELED,
          reason: 'rain',
        }),
      ]),
    );

    // notifications sent for each updated candidate
    expect(
      notificationService.notifyRideCanceledForCandidate,
    ).toHaveBeenCalledTimes(2);
    expect(
      notificationService.notifyRideCanceledForCandidate,
    ).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ id: 'ride-1' }),
      expect.objectContaining({
        driverId: 'd-1',
        status: ERideDriverCandidateStatus.CANCELED,
      }),
      'rain',
    );
    expect(
      notificationService.notifyRideCanceledForCandidate,
    ).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ id: 'ride-1' }),
      expect.objectContaining({
        driverId: 'd-2',
        status: ERideDriverCandidateStatus.CANCELED,
      }),
      'rain',
    );

    // returns refreshed ride
    expect(result).toEqual(refreshed);
  });

  it('cancels ride with default reason when none provided, no candidates -> no notifications', async () => {
    const ride = makeRide({ riderId: 'r-1', status: ERideStatus.REQUESTED });
    const updated = makeRide({ ...ride, status: ERideStatus.CANCELED });
    rideRepository.findById
      .mockResolvedValueOnce(ride)
      .mockResolvedValueOnce(null); // simulate no refreshed; returns updated

    jest
      .spyOn<any, any>(service as any, 'removePendingJobs')
      .mockResolvedValue(undefined);
    jest
      .spyOn<any, any>(service as any, 'transitionRideStatus')
      .mockResolvedValue({ ride: { ...updated }, changed: true });

    candidateRepository.findByRideId.mockResolvedValue([]); // no candidates
    rideRepository.updateRide.mockImplementation(async (r) => r);

    const result = await service.cancelRide('ride-1', {
      id: 'r-1',
      role: EClientType.RIDER,
    });

    // ride updated with default reason + fare reset
    expect(rideRepository.updateRide).toHaveBeenCalledWith(
      expect.objectContaining({
        status: ERideStatus.CANCELED,
        fareFinal: '0.00',
        // cancelReason set in transition context; explicit property only set when payload.reason exists
      }),
    );

    // no candidate save/notify
    expect(candidateRepository.saveMany).not.toHaveBeenCalled();
    expect(
      notificationService.notifyRideCanceledForCandidate,
    ).not.toHaveBeenCalled();

    // since refreshed is null, returns updated
    expect(result).toEqual(updated);
  });

  it('updates candidate reasons to default when reason not provided', async () => {
    const ride = makeRide({ riderId: 'r-1', status: ERideStatus.ENROUTE });
    const updated = makeRide({ ...ride, status: ERideStatus.CANCELED });
    const defaultReason = 'Ride cancelled by rider';

    rideRepository.findById
      .mockResolvedValueOnce(ride)
      .mockResolvedValueOnce(updated);

    jest
      .spyOn<any, any>(service as any, 'removePendingJobs')
      .mockResolvedValue(undefined);
    jest
      .spyOn<any, any>(service as any, 'transitionRideStatus')
      .mockResolvedValue({ ride: { ...updated }, changed: true });

    const cand1 = makeCandidate({
      driverId: 'a',
      status: ERideDriverCandidateStatus.ACCEPTED,
    });
    const cand2 = makeCandidate({
      driverId: 'b',
      status: ERideDriverCandidateStatus.INVITED,
    });
    candidateRepository.findByRideId.mockResolvedValue([cand1, cand2]);
    candidateRepository.saveMany.mockImplementation(async (arr) => arr);
    rideRepository.updateRide.mockImplementation(async (r) => r);

    await service.cancelRide('ride-1', { id: 'r-1', role: EClientType.RIDER });

    // candidates updated with default reason
    expect(candidateRepository.saveMany).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          driverId: 'a',
          reason: defaultReason,
          status: ERideDriverCandidateStatus.CANCELED,
        }),
        expect.objectContaining({
          driverId: 'b',
          reason: defaultReason,
          status: ERideDriverCandidateStatus.CANCELED,
        }),
      ]),
    );

    // notified with default reason
    expect(
      notificationService.notifyRideCanceledForCandidate,
    ).toHaveBeenCalledTimes(2);
    expect(
      notificationService.notifyRideCanceledForCandidate,
    ).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'ride-1' }),
      expect.objectContaining({ driverId: 'a' }),
      defaultReason,
    );
  });
});

describe('RidesManagementService.acceptRideByDriver', () => {
  let service: RidesManagementService;

  // Mocks
  let rideQueue: jest.Mocked<Queue<RideQueueJobData>>;
  let rideRepository: {
    findById: jest.Mock;
    claimDriver: jest.Mock;
    updateRide?: jest.Mock;
  };
  let rideStatusHistoryRepository: any;
  let notificationService: {
    notifyCandidateSuperseded: jest.Mock;
    notifyDriverAccepted: jest.Mock;
  };
  let candidateRepository: {
    findByRideAndDriver: jest.Mock;
    save: jest.Mock;
    saveMany?: jest.Mock;
    findByRideId?: jest.Mock;
  };
  let locationService: any;
  let httpService: any;
  let fareEngine: any;
  let configService: any;

  const makeRide = (over: Partial<any> = {}) => ({
    id: over.id ?? 'ride-1',
    riderId: over.riderId ?? 'r-1',
    driverId: over.driverId ?? null,
    status: over.status ?? ERideStatus.CANDIDATES_COMPUTED,
  });

  const makeCandidate = (over: Partial<any> = {}) => ({
    rideId: over.rideId ?? 'ride-1',
    driverId: over.driverId ?? 'd-1',
    status: over.status ?? ERideDriverCandidateStatus.INVITED,
    reason: over.reason ?? null,
    respondedAt: over.respondedAt ?? null,
  });

  beforeEach(async () => {
    jest.useFakeTimers().setSystemTime(new Date('2025-02-02T03:04:05Z'));

    rideQueue = { name: RIDE_QUEUE_NAME, opts: { connection: {} } } as any;

    rideRepository = {
      findById: jest.fn(),
      claimDriver: jest.fn(),
    };

    rideStatusHistoryRepository = {
      create: jest.fn(),
      save: jest.fn(),
    };

    notificationService = {
      notifyCandidateSuperseded: jest.fn().mockResolvedValue(undefined),
      notifyDriverAccepted: jest.fn().mockResolvedValue(undefined),
    };

    candidateRepository = {
      findByRideAndDriver: jest.fn(),
      save: jest.fn(),
    };

    locationService = {};
    httpService = {};
    fareEngine = {};
    configService = { get: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RidesManagementService,
        { provide: getQueueToken(RIDE_QUEUE_NAME), useValue: rideQueue }
        { provide: RideRepository, useValue: rideRepository },
        {
          provide: RideStatusHistoryRepository,
          useValue: rideStatusHistoryRepository,
        },
        { provide: RideNotificationService, useValue: notificationService },
        {
          provide: RideDriverCandidateRepository,
          useValue: candidateRepository,
        },
        { provide: LocationService, useValue: locationService },
        { provide: HttpService, useValue: httpService },
        { provide: FareEngineService, useValue: fareEngine },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get(RidesManagementService);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  //
  // Error guards
  //
  it('throws NotFound when ride does not exist', async () => {
    rideRepository.findById.mockResolvedValue(null);

    await expect(
      service.acceptRideByDriver('missing', 'd-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws BadRequest when ride is CANCELED', async () => {
    rideRepository.findById.mockResolvedValue(
      makeRide({ status: ERideStatus.CANCELED }),
    );

    await expect(
      service.acceptRideByDriver('ride-1', 'd-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('throws BadRequest when ride is COMPLETED', async () => {
    rideRepository.findById.mockResolvedValue(
      makeRide({ status: ERideStatus.COMPLETED }),
    );

    await expect(
      service.acceptRideByDriver('ride-1', 'd-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('throws NotFound when candidate not found for this driver', async () => {
    rideRepository.findById.mockResolvedValue(makeRide());
    candidateRepository.findByRideAndDriver.mockResolvedValue(null);

    await expect(
      service.acceptRideByDriver('ride-1', 'd-x'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws Conflict when candidate is CANCELED (invitation inactive)', async () => {
    rideRepository.findById.mockResolvedValue(makeRide());
    candidateRepository.findByRideAndDriver.mockResolvedValue(
      makeCandidate({ status: ERideDriverCandidateStatus.CANCELED }),
    );

    await expect(
      service.acceptRideByDriver('ride-1', 'd-1'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('throws BadRequest when candidate already DECLINED', async () => {
    rideRepository.findById.mockResolvedValue(makeRide());
    candidateRepository.findByRideAndDriver.mockResolvedValue(
      makeCandidate({ status: ERideDriverCandidateStatus.DECLINED }),
    );

    await expect(
      service.acceptRideByDriver('ride-1', 'd-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  //
  // Early return cases
  //
  it('early-returns ride when candidate is CONFIRMED', async () => {
    const ride = makeRide({ driverId: 'd-1', status: ERideStatus.ENROUTE });
    rideRepository.findById.mockResolvedValue(ride);
    candidateRepository.findByRideAndDriver.mockResolvedValue(
      makeCandidate({ status: ERideDriverCandidateStatus.CONFIRMED }),
    );

    const res = await service.acceptRideByDriver('ride-1', 'd-1');
    expect(res).toBe(ride);
  });

  it('early-returns ride when candidate is ACCEPTED and ride already in ACCEPTED by same driver', async () => {
    const ride = makeRide({ driverId: 'd-1', status: ERideStatus.ACCEPTED });
    rideRepository.findById.mockResolvedValue(ride);
    candidateRepository.findByRideAndDriver.mockResolvedValue(
      makeCandidate({ status: ERideDriverCandidateStatus.ACCEPTED }),
    );

    const res = await service.acceptRideByDriver('ride-1', 'd-1');
    expect(res).toBe(ride);
  });

  it('early-returns ride when candidate is ACCEPTED and ride already ENROUTE by same driver', async () => {
    const ride = makeRide({ driverId: 'd-1', status: ERideStatus.ENROUTE });
    rideRepository.findById.mockResolvedValue(ride);
    candidateRepository.findByRideAndDriver.mockResolvedValue(
      makeCandidate({ status: ERideDriverCandidateStatus.ACCEPTED }),
    );

    const res = await service.acceptRideByDriver('ride-1', 'd-1');
    expect(res).toBe(ride);
  });

  //
  // Conflict because another driver has already accepted
  //
  it('marks candidate superseded and throws Conflict when ride already has different driver', async () => {
    const ride = makeRide({
      driverId: 'd-other',
      status: ERideStatus.CANDIDATES_COMPUTED,
    });
    const cand = makeCandidate({
      driverId: 'd-1',
      status: ERideDriverCandidateStatus.INVITED,
    });

    rideRepository.findById.mockResolvedValue(ride);
    candidateRepository.findByRideAndDriver.mockResolvedValue(cand);

    await expect(
      service.acceptRideByDriver('ride-1', 'd-1'),
    ).rejects.toBeInstanceOf(ConflictException);

    // superseded: candidate updated + notify
    expect(candidateRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        driverId: 'd-1',
        status: ERideDriverCandidateStatus.CANCELED,
        reason: 'Another driver already accepted this ride',
        respondedAt: new Date('2025-02-02T03:04:05Z'),
      }),
    );
    expect(notificationService.notifyCandidateSuperseded).toHaveBeenCalledWith(
      ride,
      expect.objectContaining({ driverId: 'd-1' }),
    );
  });

  //
  // Claim path: ride has no driver yet
  //
  it('when claimDriver succeeds, sets ride.driverId, updates candidate, transitions, notifies, returns refreshed', async () => {
    const ride = makeRide({
      driverId: null,
      status: ERideStatus.CANDIDATES_COMPUTED,
    });
    const cand = makeCandidate({
      driverId: 'd-1',
      status: ERideDriverCandidateStatus.INVITED,
    });

    rideRepository.findById
      .mockResolvedValueOnce(ride) // initial read
      .mockResolvedValueOnce({
        ...ride,
        driverId: 'd-1',
        status: ERideStatus.ACCEPTED,
      }); // refreshed at end

    candidateRepository.findByRideAndDriver.mockResolvedValue(cand);
    rideRepository.claimDriver.mockResolvedValue(true);

    // transition stubs
    const transitionSpy = jest
      .spyOn<any, any>(service as any, 'transitionRideStatus')
      .mockResolvedValueOnce({
        ride: { ...ride, driverId: 'd-1', status: ERideStatus.ASSIGNED },
        changed: true,
      }) // assignment
      .mockResolvedValueOnce({
        ride: { ...ride, driverId: 'd-1', status: ERideStatus.ACCEPTED },
        changed: true,
      }); // acceptance

    const res = await service.acceptRideByDriver('ride-1', 'd-1');

    // candidate accepted & saved
    expect(candidateRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        driverId: 'd-1',
        status: ERideDriverCandidateStatus.ACCEPTED,
        reason: null,
        respondedAt: new Date('2025-02-02T03:04:05Z'),
      }),
    );

    // transitions in right order
    expect(transitionSpy).toHaveBeenNthCalledWith(
      1,
      'ride-1',
      [ERideStatus.REQUESTED, ERideStatus.CANDIDATES_COMPUTED],
      ERideStatus.ASSIGNED,
      'Driver responded to invitation',
    );
    expect(transitionSpy).toHaveBeenNthCalledWith(
      2,
      'ride-1',
      [ERideStatus.ASSIGNED, ERideStatus.CANDIDATES_COMPUTED],
      ERideStatus.ACCEPTED,
      'Driver accepted ride request',
    );

    // notified driver accepted
    expect(notificationService.notifyDriverAccepted).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'ride-1' }),
      expect.objectContaining({ driverId: 'd-1' }),
    );

    // returned refreshed ride
    expect(res).toEqual({
      id: 'ride-1',
      driverId: 'd-1',
      status: ERideStatus.ACCEPTED,
    });
  });

  it('when claimDriver fails but no conflict after re-fetch, proceeds to accept (no ride.driverId set locally), returns refreshed-or-acceptance', async () => {
    const initial = makeRide({
      driverId: null,
      status: ERideStatus.CANDIDATES_COMPUTED,
    });
    const cand = makeCandidate({
      driverId: 'd-1',
      status: ERideDriverCandidateStatus.INVITED,
    });

    rideRepository.findById
      .mockResolvedValueOnce(initial) // initial read
      .mockResolvedValueOnce(initial) // re-fetch after claim failed (still no other driver)
      .mockResolvedValueOnce({
        ...initial,
        driverId: 'd-1',
        status: ERideStatus.ACCEPTED,
      }); // refreshed at end

    candidateRepository.findByRideAndDriver.mockResolvedValue(cand);
    rideRepository.claimDriver.mockResolvedValue(false);

    const transitionSpy = jest
      .spyOn<any, any>(service as any, 'transitionRideStatus')
      .mockResolvedValueOnce({
        ride: { ...initial, status: ERideStatus.ASSIGNED },
        changed: true,
      })
      .mockResolvedValueOnce({
        ride: { ...initial, status: ERideStatus.ACCEPTED },
        changed: true,
      });

    const res = await service.acceptRideByDriver('ride-1', 'd-1');

    // still accepts candidate and proceeds
    expect(candidateRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        driverId: 'd-1',
        status: ERideDriverCandidateStatus.ACCEPTED,
      }),
    );
    expect(transitionSpy).toHaveBeenCalledTimes(2);
    expect(notificationService.notifyDriverAccepted).toHaveBeenCalled();

    expect(res).toEqual({
      id: 'ride-1',
      driverId: 'd-1',
      status: ERideStatus.ACCEPTED,
    });
  });

  it('when claimDriver fails and re-fetch shows different driver took it, marks superseded and throws Conflict', async () => {
    const initial = makeRide({
      driverId: null,
      status: ERideStatus.CANDIDATES_COMPUTED,
    });
    const after = makeRide({ driverId: 'd-2', status: ERideStatus.ASSIGNED });
    const cand = makeCandidate({
      driverId: 'd-1',
      status: ERideDriverCandidateStatus.INVITED,
    });

    rideRepository.findById
      .mockResolvedValueOnce(initial) // initial read
      .mockResolvedValueOnce(after); // re-fetch shows other driver

    candidateRepository.findByRideAndDriver.mockResolvedValue(cand);
    rideRepository.claimDriver.mockResolvedValue(false);

    await expect(
      service.acceptRideByDriver('ride-1', 'd-1'),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(candidateRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        driverId: 'd-1',
        status: ERideDriverCandidateStatus.CANCELED,
        reason: 'Another driver already accepted this ride',
      }),
    );
    expect(notificationService.notifyCandidateSuperseded).toHaveBeenCalledWith(
      after,
      expect.objectContaining({ driverId: 'd-1' }),
    );
  });
});

describe('RidesManagementService.rejectRideByDriver', () => {
  let service: RidesManagementService;

  // Mocks
  let rideQueue: jest.Mocked<Queue<RideQueueJobData>>;
  let rideRepository: {
    findById: jest.Mock;
    updateRide: jest.Mock;
  };
  let rideStatusHistoryRepository: any;
  let notificationService: {
    notifyDriverDeclined: jest.Mock;
  };
  let candidateRepository: {
    findByRideAndDriver: jest.Mock;
    save: jest.Mock;
  };
  let locationService: any;
  let httpService: any;
  let fareEngine: any;
  let configService: any;

  const makeRide = (over: Partial<any> = {}) => ({
    id: over.id ?? 'ride-1',
    riderId: over.riderId ?? 'r-1',
    driverId: over.driverId ?? null,
    status: over.status ?? ERideStatus.CANDIDATES_COMPUTED,
  });

  const makeCandidate = (over: Partial<any> = {}) => ({
    rideId: over.rideId ?? 'ride-1',
    driverId: over.driverId ?? 'd-1',
    status: over.status ?? ERideDriverCandidateStatus.INVITED,
    reason: over.reason ?? null,
    respondedAt: over.respondedAt ?? null,
  });

  beforeEach(async () => {
    jest.useFakeTimers().setSystemTime(new Date('2025-02-02T03:04:05Z'));

    rideQueue = { name: RIDE_QUEUE_NAME, opts: { connection: {} } } as any;

    rideRepository = {
      findById: jest.fn(),
      updateRide: jest.fn(),
    };

    rideStatusHistoryRepository = {
      create: jest.fn(),
      save: jest.fn(),
    };

    notificationService = {
      notifyDriverDeclined: jest.fn().mockResolvedValue(undefined),
    };

    candidateRepository = {
      findByRideAndDriver: jest.fn(),
      save: jest.fn(),
    };

    locationService = {};
    httpService = {};
    fareEngine = {};
    configService = { get: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RidesManagementService,
        { provide: getQueueToken(RIDE_QUEUE_NAME), useValue: rideQueue },
        { provide: RideRepository, useValue: rideRepository },
        {
          provide: RideStatusHistoryRepository,
          useValue: rideStatusHistoryRepository,
        },
        { provide: RideNotificationService, useValue: notificationService },
        {
          provide: RideDriverCandidateRepository,
          useValue: candidateRepository,
        },
        { provide: LocationService, useValue: locationService },
        { provide: HttpService, useValue: httpService },
        { provide: FareEngineService, useValue: fareEngine },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get(RidesManagementService);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  //
  // Guards
  //
  it('throws NotFound when ride does not exist', async () => {
    rideRepository.findById.mockResolvedValue(null);

    await expect(
      service.rejectRideByDriver('missing', 'd-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns ride when ride already CANCELED', async () => {
    const canceled = makeRide({ status: ERideStatus.CANCELED });
    rideRepository.findById.mockResolvedValue(canceled);

    const res = await service.rejectRideByDriver('ride-1', 'd-1');
    expect(res).toBe(canceled);
  });

  it('throws BadRequest when ride is COMPLETED', async () => {
    rideRepository.findById.mockResolvedValue(
      makeRide({ status: ERideStatus.COMPLETED }),
    );

    await expect(
      service.rejectRideByDriver('ride-1', 'd-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('throws BadRequest when ride is ENROUTE', async () => {
    rideRepository.findById.mockResolvedValue(
      makeRide({ status: ERideStatus.ENROUTE }),
    );

    await expect(
      service.rejectRideByDriver('ride-1', 'd-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('throws NotFound when candidate not found for driver', async () => {
    rideRepository.findById.mockResolvedValue(makeRide());
    candidateRepository.findByRideAndDriver.mockResolvedValue(null);

    await expect(
      service.rejectRideByDriver('ride-1', 'd-x'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  //
  // Early returns on candidate status
  //
  it('returns ride when candidate already DECLINED', async () => {
    const ride = makeRide();
    rideRepository.findById.mockResolvedValue(ride);
    candidateRepository.findByRideAndDriver.mockResolvedValue(
      makeCandidate({ status: ERideDriverCandidateStatus.DECLINED }),
    );

    const res = await service.rejectRideByDriver('ride-1', 'd-1');
    expect(res).toBe(ride);
    expect(candidateRepository.save).not.toHaveBeenCalled();
    expect(notificationService.notifyDriverDeclined).not.toHaveBeenCalled();
  });

  it('returns ride when candidate already CANCELED', async () => {
    const ride = makeRide();
    rideRepository.findById.mockResolvedValue(ride);
    candidateRepository.findByRideAndDriver.mockResolvedValue(
      makeCandidate({ status: ERideDriverCandidateStatus.CANCELED }),
    );

    const res = await service.rejectRideByDriver('ride-1', 'd-1');
    expect(res).toBe(ride);
    expect(candidateRepository.save).not.toHaveBeenCalled();
    expect(notificationService.notifyDriverDeclined).not.toHaveBeenCalled();
  });

  //
  // Normal decline (not currently assigned to this driver)
  //
  it('marks candidate DECLINED with default reason, not assigned driver; notifies; returns refreshed-or-current', async () => {
    const ride = makeRide({
      driverId: null,
      status: ERideStatus.CANDIDATES_COMPUTED,
    });
    const candidate = makeCandidate({
      driverId: 'd-1',
      status: ERideDriverCandidateStatus.INVITED,
    });

    rideRepository.findById
      .mockResolvedValueOnce(ride) // initial
      .mockResolvedValueOnce(ride); // refreshed (no change)
    candidateRepository.findByRideAndDriver.mockResolvedValue(candidate);

    const res = await service.rejectRideByDriver('ride-1', 'd-1');

    expect(candidateRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        driverId: 'd-1',
        status: ERideDriverCandidateStatus.DECLINED,
        reason: 'Driver declined the ride invitation',
        respondedAt: new Date('2025-02-02T03:04:05Z'),
      }),
    );

    expect(notificationService.notifyDriverDeclined).toHaveBeenCalledWith(
      ride,
      expect.objectContaining({
        driverId: 'd-1',
        status: ERideDriverCandidateStatus.DECLINED,
      }),
    );

    expect(res).toEqual(ride);
  });

  it('marks candidate DECLINED with provided reason and notifies', async () => {
    const ride = makeRide();
    const candidate = makeCandidate({
      status: ERideDriverCandidateStatus.INVITED,
    });

    rideRepository.findById
      .mockResolvedValueOnce(ride)
      .mockResolvedValueOnce(ride);
    candidateRepository.findByRideAndDriver.mockResolvedValue(candidate);

    const res = await service.rejectRideByDriver('ride-1', 'd-1', 'busy');

    expect(candidateRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        status: ERideDriverCandidateStatus.DECLINED,
        reason: 'busy',
      }),
    );
    expect(notificationService.notifyDriverDeclined).toHaveBeenCalled();
    expect(res).toEqual(ride);
  });

  //
  // Decline when this driver is currently assigned => unassign + revert status
  //
  it('when assigned to this driver: clears driverId, updateRide, revert to CANDIDATES_COMPUTED, notifies, returns refreshed', async () => {
    const assigned = makeRide({
      driverId: 'd-1',
      status: ERideStatus.ACCEPTED,
    });
    const reverted = {
      ...assigned,
      driverId: null,
      status: ERideStatus.CANDIDATES_COMPUTED,
    };
    const refreshed = { ...reverted, status: ERideStatus.CANDIDATES_COMPUTED };

    const candidate = makeCandidate({
      driverId: 'd-1',
      status: ERideDriverCandidateStatus.INVITED,
    });

    rideRepository.findById
      .mockResolvedValueOnce(assigned) // initial
      .mockResolvedValueOnce(refreshed); // final fetch

    candidateRepository.findByRideAndDriver.mockResolvedValue(candidate);

    rideRepository.updateRide.mockResolvedValue({
      ...assigned,
      driverId: null,
    });

    const transitionSpy = jest
      .spyOn<any, any>(service as any, 'transitionRideStatus')
      .mockResolvedValue({ ride: reverted, changed: true });

    const res = await service.rejectRideByDriver(
      'ride-1',
      'd-1',
      'not available',
    );

    // candidate updated
    expect(candidateRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        status: ERideDriverCandidateStatus.DECLINED,
        reason: 'not available',
        respondedAt: new Date('2025-02-02T03:04:05Z'),
      }),
    );

    // unassigned and reverted
    expect(rideRepository.updateRide).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'ride-1', driverId: null }),
    );
    expect(transitionSpy).toHaveBeenCalledWith(
      'ride-1',
      [ERideStatus.ACCEPTED, ERideStatus.ASSIGNED],
      ERideStatus.CANDIDATES_COMPUTED,
      'not available',
    );

    // notified
    expect(notificationService.notifyDriverDeclined).toHaveBeenCalledWith(
      reverted,
      expect.objectContaining({
        driverId: 'd-1',
        status: ERideDriverCandidateStatus.DECLINED,
      }),
    );

    // returned refreshed
    expect(res).toEqual(refreshed);
  });
});

describe('RidesManagementService.confirmDriverAcceptance', () => {
  let service: RidesManagementService;

  // mocks
  let rideQueue: jest.Mocked<Queue<RideQueueJobData>>;
  let rideRepository: {
    findById: jest.Mock;
    updateRide: jest.Mock;
  };
  let rideStatusHistoryRepository: any;
  let notificationService: {
    notifyRiderConfirmed: jest.Mock;
    notifyCandidateSuperseded: jest.Mock;
  };
  let candidateRepository: {
    findByRideAndDriver: jest.Mock;
    findByRideId: jest.Mock;
    saveMany: jest.Mock;
  };
  let locationService: any;
  let httpService: any;
  let fareEngine: any;
  let configService: any;

  const makeRide = (over: Partial<any> = {}) => ({
    id: over.id ?? 'ride-1',
    riderId: over.riderId ?? 'r-1',
    driverId: over.driverId ?? 'd-1', // default: has driver
    status: over.status ?? ERideStatus.ACCEPTED, // default: ACCEPTED
  });

  const makeCandidate = (over: Partial<any> = {}) => ({
    rideId: over.rideId ?? 'ride-1',
    driverId: over.driverId ?? 'd-1',
    status: over.status ?? ERideDriverCandidateStatus.ACCEPTED,
    reason: over.reason ?? null,
    respondedAt: over.respondedAt ?? null,
  });

  const makeOther = (id: string, status: ERideDriverCandidateStatus) => ({
    rideId: 'ride-1',
    driverId: id,
    status,
    reason: null,
    respondedAt: null,
  });

  beforeEach(async () => {
    jest.useFakeTimers().setSystemTime(new Date('2025-02-02T03:04:05Z'));

    rideQueue = { name: RIDE_QUEUE_NAME, opts: { connection: {} } } as any;

    rideRepository = {
      findById: jest.fn(),
      updateRide: jest.fn(),
    };
    rideStatusHistoryRepository = {
      create: jest.fn(),
      save: jest.fn(),
    };
    notificationService = {
      notifyRiderConfirmed: jest.fn().mockResolvedValue(undefined),
      notifyCandidateSuperseded: jest.fn().mockResolvedValue(undefined),
    };
    candidateRepository = {
      findByRideAndDriver: jest.fn(),
      findByRideId: jest.fn(),
      saveMany: jest.fn(),
    };
    locationService = {};
    httpService = {};
    fareEngine = {};
    configService = { get: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RidesManagementService,
        { provide: getQueueToken(RIDE_QUEUE_NAME), useValue: rideQueue },
        { provide: RideRepository, useValue: rideRepository },
        {
          provide: RideStatusHistoryRepository,
          useValue: rideStatusHistoryRepository,
        },
        { provide: RideNotificationService, useValue: notificationService },
        {
          provide: RideDriverCandidateRepository,
          useValue: candidateRepository,
        },
        { provide: LocationService, useValue: locationService },
        { provide: HttpService, useValue: httpService },
        { provide: FareEngineService, useValue: fareEngine },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get(RidesManagementService);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  //
  // Guards
  //
  it('throws NotFound when ride does not exist', async () => {
    rideRepository.findById.mockResolvedValue(null);
    await expect(
      service.confirmDriverAcceptance('absent', 'r-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws NotFound when riderId does not match ride.riderId', async () => {
    rideRepository.findById.mockResolvedValue(makeRide({ riderId: 'r-OTHER' }));
    await expect(
      service.confirmDriverAcceptance('ride-1', 'r-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws BadRequest when ride has no assigned driver', async () => {
    rideRepository.findById.mockResolvedValue(makeRide({ driverId: null }));
    await expect(
      service.confirmDriverAcceptance('ride-1', 'r-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('throws BadRequest when ride is CANCELED', async () => {
    rideRepository.findById.mockResolvedValue(
      makeRide({ status: ERideStatus.CANCELED }),
    );
    await expect(
      service.confirmDriverAcceptance('ride-1', 'r-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('returns ride as-is when status is COMPLETED', async () => {
    const completed = makeRide({ status: ERideStatus.COMPLETED });
    rideRepository.findById.mockResolvedValue(completed);
    const res = await service.confirmDriverAcceptance('ride-1', 'r-1');
    expect(res).toBe(completed);
  });

  it('throws BadRequest when status is ASSIGNED (driver not yet accepted)', async () => {
    rideRepository.findById.mockResolvedValue(
      makeRide({ status: ERideStatus.ASSIGNED }),
    );
    await expect(
      service.confirmDriverAcceptance('ride-1', 'r-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('throws BadRequest when status is REQUESTED (driver not yet accepted)', async () => {
    rideRepository.findById.mockResolvedValue(
      makeRide({ status: ERideStatus.REQUESTED }),
    );
    await expect(
      service.confirmDriverAcceptance('ride-1', 'r-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('returns ride as-is when status is ENROUTE (idempotent confirm)', async () => {
    const enroute = makeRide({ status: ERideStatus.ENROUTE });
    rideRepository.findById.mockResolvedValue(enroute);
    const res = await service.confirmDriverAcceptance('ride-1', 'r-1');
    expect(res).toBe(enroute);
  });

  it('throws Conflict when selected driver candidate not found', async () => {
    const ride = makeRide({ status: ERideStatus.ACCEPTED, driverId: 'd-1' });
    rideRepository.findById.mockResolvedValue(ride);
    candidateRepository.findByRideAndDriver.mockResolvedValue(null);

    await expect(
      service.confirmDriverAcceptance('ride-1', 'r-1'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('throws BadRequest when selected candidate status is not ACCEPTED', async () => {
    const ride = makeRide({ status: ERideStatus.ACCEPTED, driverId: 'd-1' });
    rideRepository.findById.mockResolvedValue(ride);
    candidateRepository.findByRideAndDriver.mockResolvedValue(
      makeCandidate({ status: ERideDriverCandidateStatus.INVITED }),
    );

    await expect(
      service.confirmDriverAcceptance('ride-1', 'r-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  //
  // Happy path: transition to ENROUTE, update candidates, notify, return refreshed
  //
  it('confirms: transitions to ENROUTE, chosen->CONFIRMED, others INVITED/ACCEPTED->CANCELED, notifies and returns refreshed', async () => {
    const initial = makeRide({
      status: ERideStatus.ACCEPTED,
      driverId: 'd-CHOSEN',
    });
    const transitioned = { ...initial, status: ERideStatus.ENROUTE };
    const refreshed = { ...transitioned, extra: 'refreshed' };

    const chosen = makeCandidate({
      driverId: 'd-CHOSEN',
      status: ERideDriverCandidateStatus.ACCEPTED,
    });
    const other1 = makeOther('d-INV', ERideDriverCandidateStatus.INVITED);
    const other2 = makeOther('d-ACC', ERideDriverCandidateStatus.ACCEPTED);
    const other3 = makeOther('d-CAN', ERideDriverCandidateStatus.CANCELED); // should remain untouched

    rideRepository.findById
      .mockResolvedValueOnce(initial) // initial fetch
      .mockResolvedValueOnce(refreshed); // final fetch

    candidateRepository.findByRideAndDriver.mockResolvedValue(chosen);
    candidateRepository.findByRideId.mockResolvedValue([
      chosen,
      other1,
      other2,
      other3,
    ]);

    // spy transition
    jest
      .spyOn<any, any>(service as any, 'transitionRideStatus')
      .mockResolvedValue({ ride: transitioned, changed: true });

    const res = await service.confirmDriverAcceptance('ride-1', 'r-1');

    // saveMany called with chosen->CONFIRMED and other1/other2 canceled; other3 unchanged
    expect(candidateRepository.saveMany).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          driverId: 'd-CHOSEN',
          status: ERideDriverCandidateStatus.CONFIRMED,
          reason: null,
          respondedAt: new Date('2025-02-02T03:04:05Z'),
        }),
        expect.objectContaining({
          driverId: 'd-INV',
          status: ERideDriverCandidateStatus.CANCELED,
          reason: 'Ride confirmed with another driver',
          respondedAt: new Date('2025-02-02T03:04:05Z'),
        }),
        expect.objectContaining({
          driverId: 'd-ACC',
          status: ERideDriverCandidateStatus.CANCELED,
          reason: 'Ride confirmed with another driver',
          respondedAt: new Date('2025-02-02T03:04:05Z'),
        }),
      ]),
    );

    // notifications
    expect(notificationService.notifyRiderConfirmed).toHaveBeenCalledWith(
      transitioned,
      expect.objectContaining({ driverId: 'd-CHOSEN' }),
    );
    expect(notificationService.notifyCandidateSuperseded).toHaveBeenCalledTimes(
      2,
    );
    expect(notificationService.notifyCandidateSuperseded).toHaveBeenCalledWith(
      transitioned,
      expect.objectContaining({ driverId: 'd-INV' }),
    );
    expect(notificationService.notifyCandidateSuperseded).toHaveBeenCalledWith(
      transitioned,
      expect.objectContaining({ driverId: 'd-ACC' }),
    );

    // return refreshed ride if present
    expect(res).toBe(refreshed);
  });

  it('confirms with only chosen candidate in list: still updates chosen and notifies; saveMany called once', async () => {
    const initial = makeRide({
      status: ERideStatus.ACCEPTED,
      driverId: 'd-OK',
    });
    const transitioned = { ...initial, status: ERideStatus.ENROUTE };

    const chosen = makeCandidate({
      driverId: 'd-OK',
      status: ERideDriverCandidateStatus.ACCEPTED,
    });

    rideRepository.findById
      .mockResolvedValueOnce(initial)
      .mockResolvedValueOnce(transitioned); // no separate refreshed doc, return transitioned

    candidateRepository.findByRideAndDriver.mockResolvedValue(chosen);
    candidateRepository.findByRideId.mockResolvedValue([chosen]);

    jest
      .spyOn<any, any>(service as any, 'transitionRideStatus')
      .mockResolvedValue({ ride: transitioned, changed: true });

    const res = await service.confirmDriverAcceptance('ride-1', 'r-1');

    // chosen becomes CONFIRMED
    expect(candidateRepository.saveMany).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          driverId: 'd-OK',
          status: ERideDriverCandidateStatus.CONFIRMED,
          reason: null,
          respondedAt: new Date('2025-02-02T03:04:05Z'),
        }),
      ]),
    );
    // no superseded notifications
    expect(
      notificationService.notifyCandidateSuperseded,
    ).not.toHaveBeenCalled();
    expect(notificationService.notifyRiderConfirmed).toHaveBeenCalledWith(
      transitioned,
      expect.objectContaining({ driverId: 'd-OK' }),
    );
    // returns transitioned since refreshed = null
    expect(res).toEqual(transitioned);
  });

  it('when candidate list is empty: saveMany not called; still notifies chosen rider confirmation', async () => {
    const initial = makeRide({
      status: ERideStatus.ACCEPTED,
      driverId: 'd-OK',
    });
    const transitioned = { ...initial, status: ERideStatus.ENROUTE };

    const chosen = makeCandidate({
      driverId: 'd-OK',
      status: ERideDriverCandidateStatus.ACCEPTED,
    });

    rideRepository.findById
      .mockResolvedValueOnce(initial)
      .mockResolvedValueOnce(transitioned);

    candidateRepository.findByRideAndDriver.mockResolvedValue(chosen);
    candidateRepository.findByRideId.mockResolvedValue([]); // empty list

    jest
      .spyOn<any, any>(service as any, 'transitionRideStatus')
      .mockResolvedValue({ ride: transitioned, changed: true });

    const res = await service.confirmDriverAcceptance('ride-1', 'r-1');

    expect(candidateRepository.saveMany).not.toHaveBeenCalled();
    expect(notificationService.notifyRiderConfirmed).toHaveBeenCalledWith(
      transitioned,
      expect.objectContaining({ driverId: 'd-OK' }),
    );
    expect(
      notificationService.notifyCandidateSuperseded,
    ).not.toHaveBeenCalled();
    expect(res).toEqual(transitioned);
  });
});
