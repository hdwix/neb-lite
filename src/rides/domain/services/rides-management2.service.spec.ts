import { Test, TestingModule } from '@nestjs/testing';
import { RidesManagementService } from './rides-management.service';
import { getQueueToken } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import {
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { of, throwError } from 'rxjs';

import { RideRepository } from '../../infrastructure/repositories/ride.repository';
import { RideStatusHistoryRepository } from '../../infrastructure/repositories/ride-status-history.repository';
import { RideNotificationService } from './ride-notification.service';
import { LocationService } from '../../../location/domain/services/location.service';
import { RideDriverCandidateRepository } from '../../infrastructure/repositories/ride-driver-candidate.repository';
import { FareEngineService } from './fare-engine.service';

import { ERideStatus } from '../constants/ride-status.enum';
import { ERideDriverCandidateStatus } from '../constants/ride-driver-candidate-status.enum';
import { EClientType } from '../../../app/enums/client-type.enum';
import { RIDE_QUEUE_NAME } from '../types/ride-queue.types';
import { Ride } from '../entities/ride.entity';
import { RideDriverCandidate } from '../entities/ride-driver-candidate.entity';

type AnyObj = Record<string, any>;

const makeRide = (patch?: Partial<Ride>): Ride => {
  const r = new Ride();
  r.id = 'ride-1';
  r.riderId = 'r-1';
  r.driverId = 'd-1';
  r.status = ERideStatus.CANDIDATES_COMPUTED;
  return Object.assign(r, patch ?? {});
};

const makeCandidate = (
  patch?: Partial<RideDriverCandidate>,
): RideDriverCandidate => {
  const c = new RideDriverCandidate();
  c.rideId = 'ride-1';
  c.driverId = 'd-1';
  c.status = ERideDriverCandidateStatus.INVITED;
  c.reason = null;
  c.distanceMeters = 120;
  return Object.assign(c, patch ?? {});
};

describe('RidesManagementService', () => {
  let service: RidesManagementService;

  // Mocks
  const queueMock = {
    name: RIDE_QUEUE_NAME,
    opts: { connection: {} },
    add: jest.fn(),
    remove: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<Queue>;

  const rideRepoMock = {
    findUnfinishedRideByRiderId: jest.fn(),
    createRideWithDetails: jest.fn(),
    findById: jest.fn(),
    updateRide: jest.fn(),
    claimDriver: jest.fn(),
  };

  const historyRepoMock = {
    create: jest.fn(),
    save: jest.fn(),
  };

  const notificationMock = {
    notifyRideMatched: jest.fn(),
    notifyRideOffered: jest.fn(),
    notifyDriverAccepted: jest.fn(),
    notifyDriverDeclined: jest.fn(),
    notifyRiderConfirmed: jest.fn(),
    notifyCandidateSuperseded: jest.fn(),
    notifyRideCanceledForCandidate: jest.fn(),
  };

  const candidateRepoMock = {
    findByRideId: jest.fn(),
    findByRideAndDriver: jest.fn(),
    save: jest.fn(),
    saveMany: jest.fn(),
  };

  const locationMock = {
    getNearbyDrivers: jest.fn(),
  };

  const httpMock = {
    get: jest.fn(),
  } as unknown as jest.Mocked<HttpService>;

  const fareMock = {
    calculateEstimatedFare: jest.fn(),
  } as unknown as jest.Mocked<FareEngineService>;

  const configMock = {
    get: jest.fn(),
  } as unknown as jest.Mocked<ConfigService>;

  beforeEach(async () => {
    jest.resetAllMocks();

    // Defaults
    fareMock.calculateEstimatedFare.mockReturnValue('9000.00');
    rideRepoMock.findById.mockResolvedValue(makeRide());
    rideRepoMock.updateRide.mockImplementation(async (r: Ride) => r);
    historyRepoMock.create.mockImplementation((h: any) => h);
    historyRepoMock.save.mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RidesManagementService,
        { provide: getQueueToken(RIDE_QUEUE_NAME), useValue: queueMock },
        { provide: RideRepository, useValue: rideRepoMock },
        { provide: RideStatusHistoryRepository, useValue: historyRepoMock },
        { provide: RideNotificationService, useValue: notificationMock },
        { provide: RideDriverCandidateRepository, useValue: candidateRepoMock },
        { provide: LocationService, useValue: locationMock },
        { provide: HttpService, useValue: httpMock },
        { provide: FareEngineService, useValue: fareMock },
        { provide: ConfigService, useValue: configMock },
      ],
    }).compile();

    service = module.get(RidesManagementService);

    // Silence logs
    jest
      .spyOn(service['logger'], 'log')
      .mockImplementation(() => undefined as any);
    jest
      .spyOn(service['logger'], 'error')
      .mockImplementation(() => undefined as any);
  });

  //
  // createRide
  //
  describe('createRide', () => {
    it('throws BadRequest when riderId missing', async () => {
      await expect(
        service.createRide('', {
          pickup: { longitude: 1, latitude: 2 },
          dropoff: { longitude: 3, latitude: 4 },
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws Conflict when rider already has unfinished ride', async () => {
      rideRepoMock.findUnfinishedRideByRiderId.mockResolvedValue(makeRide());
      await expect(
        service.createRide('r-1', {
          pickup: { longitude: 1, latitude: 2 },
          dropoff: { longitude: 3, latitude: 4 },
        } as any),
      ).rejects.toThrow(ConflictException);
    });

    it('throws Error("unable to find driver...") when no nearby drivers', async () => {
      rideRepoMock.findUnfinishedRideByRiderId.mockResolvedValue(null);
      locationMock.getNearbyDrivers.mockResolvedValue([]);

      // route estimates are fetched via private method; stub it to succeed
      jest
        .spyOn<any, any>(service as any, 'requestRouteEstimatesThroughQueue')
        .mockResolvedValue({ distanceKm: 3.2, durationSeconds: 600 });

      await expect(
        service.createRide('r-1', {
          pickup: { longitude: 1, latitude: 2 },
          dropoff: { longitude: 3, latitude: 4 },
          maxDrivers: 5,
        }),
      ).rejects.toThrow(/unable to find driver/);

      expect(queueMock.remove).toHaveBeenCalled(); // cleanup path
    });

    it('happy path: creates ride, saves candidates, sends notifications', async () => {
      rideRepoMock.findUnfinishedRideByRiderId.mockResolvedValue(null);

      const nearbyDrivers = [
        { driverId: 'd-1', distanceMeters: 100 },
        { driverId: 'd-2', distanceMeters: 200 },
      ];
      locationMock.getNearbyDrivers.mockResolvedValue(nearbyDrivers);

      jest
        .spyOn<any, any>(service as any, 'requestRouteEstimatesThroughQueue')
        .mockResolvedValue({ distanceKm: 2.5, durationSeconds: 420 });

      const createdRide = makeRide({
        id: 'ride-new',
        driverId: null,
        status: ERideStatus.CANDIDATES_COMPUTED,
      });
      const candidates = [
        makeCandidate({
          driverId: 'd-1',
          status: ERideDriverCandidateStatus.INVITED,
        }),
        makeCandidate({
          driverId: 'd-2',
          status: ERideDriverCandidateStatus.INVITED,
        }),
      ];

      rideRepoMock.createRideWithDetails.mockResolvedValue({
        ride: createdRide,
        candidates,
      });

      const res = await service.createRide('r-1', {
        pickup: { longitude: 1, latitude: 2 },
        dropoff: { longitude: 3, latitude: 4 },
      });

      expect(res.ride.id).toBe('ride-new');
      expect(res.candidates).toHaveLength(2);
      expect(notificationMock.notifyRideOffered).toHaveBeenCalledTimes(2);
      expect(notificationMock.notifyRideMatched).toHaveBeenCalledTimes(1);
    });

    it('wraps unknown error as InternalServerErrorException', async () => {
      rideRepoMock.findUnfinishedRideByRiderId.mockResolvedValue(null);
      locationMock.getNearbyDrivers.mockResolvedValue([
        { driverId: 'd-1', distanceMeters: 111 },
      ]);
      jest
        .spyOn<any, any>(service as any, 'requestRouteEstimatesThroughQueue')
        .mockRejectedValue(new Error('boom'));

      await expect(
        service.createRide('r-1', {
          pickup: { longitude: 1, latitude: 2 },
          dropoff: { longitude: 3, latitude: 4 },
        }),
      ).rejects.toThrow(InternalServerErrorException);

      expect(queueMock.remove).toHaveBeenCalled();
    });
  });

  //
  // getRideById + ensureRequesterCanAccessRide
  //
  describe('getRideById (with access control)', () => {
    it('throws NotFound when ride missing', async () => {
      rideRepoMock.findById.mockResolvedValueOnce(null);
      await expect(
        service.getRideById('unknown', { id: 'r-1', role: EClientType.RIDER }),
      ).rejects.toThrow(NotFoundException);
    });

    it('allows rider for own ride', async () => {
      rideRepoMock.findById.mockResolvedValueOnce(
        makeRide({ riderId: 'r-x', driverId: null }),
      );
      await expect(
        service.getRideById('ride-1', { id: 'r-x', role: EClientType.RIDER }),
      ).resolves.toBeDefined();
    });

    it('denies rider for others ride', async () => {
      rideRepoMock.findById.mockResolvedValueOnce(makeRide({ riderId: 'r-1' }));
      await expect(
        service.getRideById('ride-1', { id: 'r-2', role: EClientType.RIDER }),
      ).rejects.toThrow(NotFoundException);
    });

    it('allows driver for own ride', async () => {
      rideRepoMock.findById.mockResolvedValueOnce(
        makeRide({ driverId: 'd-x' }),
      );
      await expect(
        service.getRideById('ride-1', { id: 'd-x', role: EClientType.DRIVER }),
      ).resolves.toBeDefined();
    });

    it('denies driver for others ride', async () => {
      rideRepoMock.findById.mockResolvedValueOnce(
        makeRide({ driverId: 'd-1' }),
      );
      await expect(
        service.getRideById('ride-1', { id: 'd-2', role: EClientType.DRIVER }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequest when requester.id missing', async () => {
      rideRepoMock.findById.mockResolvedValueOnce(makeRide());
      await expect(
        service.getRideById('ride-1', { id: '' } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('no role => allowed (service only checks role if provided)', async () => {
      rideRepoMock.findById.mockResolvedValueOnce(makeRide({ riderId: 'r-1' }));
      await expect(
        service.getRideById('ride-1', { id: 'someone' }),
      ).resolves.toBeDefined();
    });
  });

  //
  // cancelRide
  //
  describe('cancelRide', () => {
    it('errors: not found / requester mismatch / completed', async () => {
      rideRepoMock.findById.mockResolvedValueOnce(null);
      await expect(service.cancelRide('rid', { id: 'r-1' })).rejects.toThrow(
        NotFoundException,
      );

      rideRepoMock.findById.mockResolvedValueOnce(makeRide({ riderId: 'r-1' }));
      await expect(service.cancelRide('rid', { id: 'r-2' })).rejects.toThrow(
        NotFoundException,
      );

      rideRepoMock.findById.mockResolvedValueOnce(
        makeRide({ riderId: 'r-1', status: ERideStatus.COMPLETED }),
      );
      await expect(service.cancelRide('rid', { id: 'r-1' })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('already canceled: returns ride as-is', async () => {
      rideRepoMock.findById.mockResolvedValueOnce(
        makeRide({ riderId: 'r-1', status: ERideStatus.CANCELED }),
      );
      const res = await service.cancelRide('rid', { id: 'r-1' });
      expect(res.status).toBe(ERideStatus.CANCELED);
    });

    it('cancels and notifies all candidates', async () => {
      // initial found ride
      rideRepoMock.findById.mockResolvedValueOnce(
        makeRide({
          id: 'rid-1',
          riderId: 'r-1',
          driverId: 'd-z',
          status: ERideStatus.CANDIDATES_COMPUTED,
        }),
      );
      // after update refresh
      rideRepoMock.findById.mockResolvedValueOnce(
        makeRide({
          id: 'rid-1',
          riderId: 'r-1',
          driverId: 'd-z',
          status: ERideStatus.CANCELED,
        }),
      );

      const cands = [
        makeCandidate({
          driverId: 'd-a',
          status: ERideDriverCandidateStatus.INVITED,
        }),
        makeCandidate({
          driverId: 'd-b',
          status: ERideDriverCandidateStatus.ACCEPTED,
        }),
      ];
      candidateRepoMock.findByRideId.mockResolvedValue(cands);
      candidateRepoMock.saveMany.mockImplementation(async () => undefined);

      const res = await service.cancelRide(
        'rid-1',
        { id: 'r-1' },
        { reason: 'changed mind' },
      );
      expect(res.status).toBe(ERideStatus.CANCELED);
      expect(candidateRepoMock.saveMany).toHaveBeenCalled();
      expect(
        notificationMock.notifyRideCanceledForCandidate,
      ).toHaveBeenCalledTimes(2);
    });
  });

  //
  // acceptRideByDriver
  //
  describe('acceptRideByDriver', () => {
    it('errors: ride not found / canceled / completed', async () => {
      rideRepoMock.findById.mockResolvedValueOnce(null);
      await expect(service.acceptRideByDriver('rid', 'd-1')).rejects.toThrow(
        NotFoundException,
      );

      rideRepoMock.findById.mockResolvedValueOnce(
        makeRide({ status: ERideStatus.CANCELED }),
      );
      await expect(service.acceptRideByDriver('rid', 'd-1')).rejects.toThrow(
        BadRequestException,
      );

      rideRepoMock.findById.mockResolvedValueOnce(
        makeRide({ status: ERideStatus.COMPLETED }),
      );
      await expect(service.acceptRideByDriver('rid', 'd-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('errors: candidate not found / canceled / declined', async () => {
      rideRepoMock.findById.mockResolvedValue(
        makeRide({
          id: 'rid-1',
          driverId: null,
          status: ERideStatus.CANDIDATES_COMPUTED,
        }),
      );
      candidateRepoMock.findByRideAndDriver.mockResolvedValueOnce(null);
      await expect(service.acceptRideByDriver('rid-1', 'd-x')).rejects.toThrow(
        NotFoundException,
      );

      candidateRepoMock.findByRideAndDriver.mockResolvedValueOnce(
        makeCandidate({ status: ERideDriverCandidateStatus.CANCELED }),
      );
      await expect(service.acceptRideByDriver('rid-1', 'd-1')).rejects.toThrow(
        ConflictException,
      );

      candidateRepoMock.findByRideAndDriver.mockResolvedValueOnce(
        makeCandidate({ status: ERideDriverCandidateStatus.DECLINED }),
      );
      await expect(service.acceptRideByDriver('rid-1', 'd-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('conflict when another driver already accepted', async () => {
      // ride already has different driver
      rideRepoMock.findById.mockResolvedValueOnce(
        makeRide({
          driverId: 'd-other',
          status: ERideStatus.CANDIDATES_COMPUTED,
        }),
      );
      candidateRepoMock.findByRideAndDriver.mockResolvedValueOnce(
        makeCandidate(),
      );
      await expect(service.acceptRideByDriver('rid-1', 'd-1')).rejects.toThrow(
        ConflictException,
      );
      expect(notificationMock.notifyCandidateSuperseded).toHaveBeenCalled();
    });

    it('happy path: claim driver, transition ASSIGNED/ACCEPTED, notify', async () => {
      rideRepoMock.findById
        .mockResolvedValueOnce(
          makeRide({
            id: 'rid-1',
            driverId: null,
            status: ERideStatus.CANDIDATES_COMPUTED,
          }),
        ) // first
        .mockResolvedValueOnce(
          makeRide({
            id: 'rid-1',
            driverId: 'd-1',
            status: ERideStatus.ACCEPTED,
          }),
        ); // refresh

      rideRepoMock.claimDriver.mockResolvedValue(true);
      candidateRepoMock.findByRideAndDriver.mockResolvedValue(makeCandidate());

      const res = await service.acceptRideByDriver('rid-1', 'd-1');
      expect(res.driverId).toBe('d-1');
      expect(notificationMock.notifyDriverAccepted).toHaveBeenCalled();
    });
  });

  //
  // rejectRideByDriver
  //
  describe('rejectRideByDriver', () => {
    it('errors: not found / completed / enroute', async () => {
      rideRepoMock.findById.mockResolvedValueOnce(null);
      await expect(service.rejectRideByDriver('rid', 'd-1')).rejects.toThrow(
        NotFoundException,
      );

      rideRepoMock.findById.mockResolvedValueOnce(
        makeRide({ status: ERideStatus.COMPLETED }),
      );
      await expect(service.rejectRideByDriver('rid', 'd-1')).rejects.toThrow(
        BadRequestException,
      );

      rideRepoMock.findById.mockResolvedValueOnce(
        makeRide({ status: ERideStatus.ENROUTE }),
      );
      await expect(service.rejectRideByDriver('rid', 'd-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('returns as-is when ride canceled / candidate already declined or canceled', async () => {
      rideRepoMock.findById.mockResolvedValueOnce(
        makeRide({ status: ERideStatus.CANCELED }),
      );
      const res1 = await service.rejectRideByDriver('rid', 'd-1');
      expect(res1.status).toBe(ERideStatus.CANCELED);

      rideRepoMock.findById.mockResolvedValueOnce(
        makeRide({ status: ERideStatus.CANDIDATES_COMPUTED }),
      );
      candidateRepoMock.findByRideAndDriver.mockResolvedValueOnce(
        makeCandidate({ status: ERideDriverCandidateStatus.DECLINED }),
      );
      const res2 = await service.rejectRideByDriver('rid2', 'd-1');
      expect(res2).toBeDefined();

      rideRepoMock.findById.mockResolvedValueOnce(
        makeRide({ status: ERideStatus.CANDIDATES_COMPUTED }),
      );
      candidateRepoMock.findByRideAndDriver.mockResolvedValueOnce(
        makeCandidate({ status: ERideDriverCandidateStatus.CANCELED }),
      );
      const res3 = await service.rejectRideByDriver('rid3', 'd-1');
      expect(res3).toBeDefined();
    });

    it('errors: candidate not found', async () => {
      rideRepoMock.findById.mockResolvedValueOnce(
        makeRide({ status: ERideStatus.CANDIDATES_COMPUTED }),
      );
      candidateRepoMock.findByRideAndDriver.mockResolvedValueOnce(null);
      await expect(service.rejectRideByDriver('rid', 'd-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('when rejecting current driver, unassigns and reverts status, notifies', async () => {
      rideRepoMock.findById
        .mockResolvedValueOnce(
          makeRide({
            id: 'rid-1',
            status: ERideStatus.ACCEPTED,
            driverId: 'd-1',
          }),
        )
        .mockResolvedValueOnce(
          makeRide({
            id: 'rid-1',
            status: ERideStatus.CANDIDATES_COMPUTED,
            driverId: null,
          }),
        ); // refresh

      candidateRepoMock.findByRideAndDriver.mockResolvedValueOnce(
        makeCandidate({ driverId: 'd-1' }),
      );
      rideRepoMock.updateRide.mockImplementation(async (r: Ride) => r);

      const res = await service.rejectRideByDriver('rid-1', 'd-1', 'no time');
      expect(res.driverId).toBeNull();
      expect(notificationMock.notifyDriverDeclined).toHaveBeenCalled();
    });
  });

  //
  // confirmDriverAcceptance
  //
  describe('confirmDriverAcceptance', () => {
    it('errors for missing ride, wrong rider, no driver, canceled, assigned/requested, candidate missing, candidate not ACCEPTED', async () => {
      rideRepoMock.findById.mockResolvedValueOnce(null);
      await expect(
        service.confirmDriverAcceptance('rid', 'r-1'),
      ).rejects.toThrow(NotFoundException);

      rideRepoMock.findById.mockResolvedValueOnce(makeRide({ riderId: 'r-1' }));
      await expect(
        service.confirmDriverAcceptance('rid', 'r-2'),
      ).rejects.toThrow(NotFoundException);

      rideRepoMock.findById.mockResolvedValueOnce(
        makeRide({ riderId: 'r-1', driverId: null }),
      );
      await expect(
        service.confirmDriverAcceptance('rid', 'r-1'),
      ).rejects.toThrow(BadRequestException);

      rideRepoMock.findById.mockResolvedValueOnce(
        makeRide({
          riderId: 'r-1',
          driverId: 'd-1',
          status: ERideStatus.CANCELED,
        }),
      );
      await expect(
        service.confirmDriverAcceptance('rid', 'r-1'),
      ).rejects.toThrow(BadRequestException);

      rideRepoMock.findById.mockResolvedValueOnce(
        makeRide({
          riderId: 'r-1',
          driverId: 'd-1',
          status: ERideStatus.ASSIGNED,
        }),
      );
      await expect(
        service.confirmDriverAcceptance('rid', 'r-1'),
      ).rejects.toThrow(BadRequestException);

      rideRepoMock.findById.mockResolvedValueOnce(
        makeRide({
          riderId: 'r-1',
          driverId: 'd-1',
          status: ERideStatus.REQUESTED,
        }),
      );
      await expect(
        service.confirmDriverAcceptance('rid', 'r-1'),
      ).rejects.toThrow(BadRequestException);

      rideRepoMock.findById.mockResolvedValueOnce(
        makeRide({
          riderId: 'r-1',
          driverId: 'd-1',
          status: ERideStatus.ACCEPTED,
        }),
      );
      candidateRepoMock.findByRideAndDriver.mockResolvedValueOnce(null);
      await expect(
        service.confirmDriverAcceptance('rid', 'r-1'),
      ).rejects.toThrow(ConflictException);

      rideRepoMock.findById.mockResolvedValueOnce(
        makeRide({
          riderId: 'r-1',
          driverId: 'd-1',
          status: ERideStatus.ACCEPTED,
        }),
      );
      candidateRepoMock.findByRideAndDriver.mockResolvedValueOnce(
        makeCandidate({
          driverId: 'd-1',
          status: ERideDriverCandidateStatus.DECLINED,
        }),
      );
      await expect(
        service.confirmDriverAcceptance('rid', 'r-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('success path: marks chosen as CONFIRMED, cancels others, notifies', async () => {
      const rideId = 'rid-1';
      const baseRide = makeRide({
        id: rideId,
        riderId: 'r-1',
        driverId: 'd-1',
        status: ERideStatus.ACCEPTED,
      });
      rideRepoMock.findById
        .mockResolvedValueOnce(baseRide) // initial
        .mockResolvedValueOnce(
          makeRide({
            id: rideId,
            driverId: 'd-1',
            status: ERideStatus.ENROUTE,
          }),
        ); // refresh

      candidateRepoMock.findByRideAndDriver.mockResolvedValueOnce(
        makeCandidate({
          driverId: 'd-1',
          status: ERideDriverCandidateStatus.ACCEPTED,
        }),
      );
      candidateRepoMock.findByRideId.mockResolvedValueOnce([
        makeCandidate({
          driverId: 'd-1',
          status: ERideDriverCandidateStatus.ACCEPTED,
        }),
        makeCandidate({
          driverId: 'd-2',
          status: ERideDriverCandidateStatus.ACCEPTED,
        }),
      ]);
      candidateRepoMock.saveMany.mockResolvedValue(undefined);

      const res = await service.confirmDriverAcceptance(rideId, 'r-1');
      expect(res.status).toBe(ERideStatus.ENROUTE);
      expect(notificationMock.notifyRiderConfirmed).toHaveBeenCalled();
      expect(notificationMock.notifyCandidateSuperseded).toHaveBeenCalledTimes(
        1,
      );
    });
  });

  //
  // rejectDriverAcceptance
  //
  describe('rejectDriverAcceptance', () => {
    it('errors for wrong rider / no driver / completed / enroute / assigned|requested', async () => {
      rideRepoMock.findById.mockResolvedValueOnce(makeRide({ riderId: 'r-1' }));
      await expect(
        service.rejectDriverAcceptance('rid', 'r-2'),
      ).rejects.toThrow(NotFoundException);

      rideRepoMock.findById.mockResolvedValueOnce(
        makeRide({ riderId: 'r-1', driverId: null }),
      );
      await expect(
        service.rejectDriverAcceptance('rid', 'r-1'),
      ).rejects.toThrow(BadRequestException);

      rideRepoMock.findById.mockResolvedValueOnce(
        makeRide({
          riderId: 'r-1',
          driverId: 'd-1',
          status: ERideStatus.COMPLETED,
        }),
      );
      await expect(
        service.rejectDriverAcceptance('rid', 'r-1'),
      ).rejects.toThrow(BadRequestException);

      rideRepoMock.findById.mockResolvedValueOnce(
        makeRide({
          riderId: 'r-1',
          driverId: 'd-1',
          status: ERideStatus.ENROUTE,
        }),
      );
      await expect(
        service.rejectDriverAcceptance('rid', 'r-1'),
      ).rejects.toThrow(BadRequestException);

      rideRepoMock.findById.mockResolvedValueOnce(
        makeRide({
          riderId: 'r-1',
          driverId: 'd-1',
          status: ERideStatus.ASSIGNED,
        }),
      );
      await expect(
        service.rejectDriverAcceptance('rid', 'r-1'),
      ).rejects.toThrow(BadRequestException);

      rideRepoMock.findById.mockResolvedValueOnce(
        makeRide({
          riderId: 'r-1',
          driverId: 'd-1',
          status: ERideStatus.REQUESTED,
        }),
      );
      await expect(
        service.rejectDriverAcceptance('rid', 'r-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('errors when candidate not found', async () => {
      rideRepoMock.findById.mockResolvedValueOnce(
        makeRide({
          riderId: 'r-1',
          driverId: 'd-1',
          status: ERideStatus.ACCEPTED,
        }),
      );
      candidateRepoMock.findByRideAndDriver.mockResolvedValueOnce(null);
      await expect(
        service.rejectDriverAcceptance('rid', 'r-1'),
      ).rejects.toThrow(ConflictException);
    });

    it('success path: cancels candidate, clears driver, transitions back, notifies', async () => {
      const baseRide = makeRide({
        id: 'rid-1',
        riderId: 'r-1',
        driverId: 'd-1',
        status: ERideStatus.ACCEPTED,
      });
      rideRepoMock.findById
        .mockResolvedValueOnce(baseRide) // initial
        .mockResolvedValueOnce(
          makeRide({
            id: 'rid-1',
            driverId: null,
            status: ERideStatus.CANDIDATES_COMPUTED,
          }),
        ); // refresh

      candidateRepoMock.findByRideAndDriver.mockResolvedValueOnce(
        makeCandidate({
          driverId: 'd-1',
          status: ERideDriverCandidateStatus.ACCEPTED,
        }),
      );
      candidateRepoMock.save.mockResolvedValue(undefined);

      const res = await service.rejectDriverAcceptance('rid-1', 'r-1', 'nope');
      expect(res.status).toBe(ERideStatus.CANDIDATES_COMPUTED);
      expect(notificationMock.notifyRiderRejectedDriver).toHaveBeenCalled();
    });
  });

  //
  // fetchRouteEstimates + requestRouteSummary + parse path
  //
  describe('fetchRouteEstimates / requestRouteSummary / parse', () => {
    it('happy path rounds distance and duration', async () => {
      // config for ORS
      (configMock.get as any) = jest.fn((k: string) => {
        if (k === 'SKIP_ORS_CALL') return false;
        if (k === 'ORS_URL') return 'https://example.com/route';
        if (k === 'ORS_APIKEY') return 'apikey';
        return undefined;
      });

      httpMock.get.mockReturnValue(
        of({
          data: {
            features: [
              {
                properties: {
                  summary: {
                    distance: 2345.6789,
                    duration: 421.9,
                  },
                },
              },
            ],
          },
        } as any),
      );

      const res = await service.fetchRouteEstimates(
        { longitude: 1, latitude: 2 },
        { longitude: 3, latitude: 4 },
      );

      expect(res.distanceKm).toBe(2.346); // 2345.6789 / 1000 -> 2.3456789 -> 2.346
      expect(res.durationSeconds).toBe(422); // rounded
    });

    it('requestRouteSummary throws when missing base url', async () => {
      (configMock.get as any) = jest.fn((k: string) => {
        if (k === 'SKIP_ORS_CALL') return false;
        if (k === 'ORS_URL') return '';
        return undefined;
      });

      await expect(
        (service as any).requestRouteSummary(
          { longitude: 1, latitude: 2 },
          { longitude: 3, latitude: 4 },
        ),
      ).rejects.toThrow(/Missing configuration/);
    });

    it('handles axios error -> BadRequest via handleRouteEstimationError', async () => {
      (configMock.get as any) = jest.fn((k: string) => {
        if (k === 'SKIP_ORS_CALL') return false;
        if (k === 'ORS_URL') return 'https://example.com/route';
        return undefined;
      });

      httpMock.get.mockReturnValue(
        throwError(() => ({
          isAxiosError: true,
          response: { status: 500, statusText: 'ERR' },
          message: 'x',
        })),
      );

      await expect(
        service.fetchRouteEstimates(
          { longitude: 1, latitude: 2 },
          { longitude: 3, latitude: 4 },
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('parse errors -> BadRequest via handleRouteEstimationError', async () => {
      (configMock.get as any) = jest.fn((k: string) => {
        if (k === 'SKIP_ORS_CALL') return false;
        if (k === 'ORS_URL') return 'https://example.com/route';
        return undefined;
      });

      httpMock.get.mockReturnValue(of({ data: {} } as any)); // invalid shape
      await expect(
        service.fetchRouteEstimates(
          { longitude: 1, latitude: 2 },
          { longitude: 3, latitude: 4 },
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  //
  // requestRouteEstimatesThroughQueue (job waits; we stub queue events)
  //
  describe('requestRouteEstimatesThroughQueue', () => {
    it('returns result from job.waitUntilFinished', async () => {
      const job: AnyObj = {
        waitUntilFinished: jest
          .fn()
          .mockResolvedValue({ distanceKm: 1.23, durationSeconds: 111 }),
      };
      queueMock.add = jest.fn().mockResolvedValue(job as any);

      const close = jest.fn().mockResolvedValue(undefined);
      const ready = jest.fn().mockResolvedValue(undefined);

      jest
        .spyOn<any, any>(service as any, 'createQueueEvents')
        .mockResolvedValue({ waitUntilReady: ready, close });

      const result = await (service as any).requestRouteEstimatesThroughQueue(
        'job-1',
        { longitude: 1, latitude: 2 },
        { longitude: 3, latitude: 4 },
      );

      expect(result).toEqual({ distanceKm: 1.23, durationSeconds: 111 });
      expect(close).toHaveBeenCalled();
    });

    it('on waitUntilFinished error -> BadRequest, and events closed', async () => {
      const job: AnyObj = {
        waitUntilFinished: jest.fn().mockRejectedValue(new Error('fail')),
      };
      queueMock.add = jest.fn().mockResolvedValue(job as any);

      const close = jest.fn().mockResolvedValue(undefined);
      const ready = jest.fn().mockResolvedValue(undefined);
      jest
        .spyOn<any, any>(service as any, 'createQueueEvents')
        .mockResolvedValue({ waitUntilReady: ready, close });

      await expect(
        (service as any).requestRouteEstimatesThroughQueue(
          'job-2',
          { longitude: 1, latitude: 2 },
          { longitude: 3, latitude: 4 },
        ),
      ).rejects.toThrow(BadRequestException);

      expect(close).toHaveBeenCalled();
    });
  });

  //
  // resolveCandidateLimit + buildDriverCandidateInputs (dedupe & null distance)
  //
  describe('candidate helpers', () => {
    it('resolveCandidateLimit caps >50 and defaults when missing', () => {
      expect((service as any).resolveCandidateLimit(undefined)).toBe(20);
      expect((service as any).resolveCandidateLimit(5)).toBe(5);
      expect((service as any).resolveCandidateLimit(51)).toBe(20);
    });

    it('buildDriverCandidateInputs dedupes and normalizes distance', () => {
      const inputs = (service as any).buildDriverCandidateInputs([
        { driverId: 'd-1', distanceMeters: 100.9 },
        { driverId: 'd-1', distanceMeters: 200 }, // dup
        { driverId: 'd-2', distanceMeters: null },
        { driverId: '', distanceMeters: 10 }, // skipped
      ]);
      expect(inputs).toEqual([
        {
          driverId: 'd-1',
          status: ERideDriverCandidateStatus.INVITED,
          distanceMeters: 101,
        },
        {
          driverId: 'd-2',
          status: ERideDriverCandidateStatus.INVITED,
          distanceMeters: null,
        },
      ]);
    });
  });

  //
  // transitionRideStatus
  //
  describe('transitionRideStatus', () => {
    it('skips when current not in allowed statuses', async () => {
      rideRepoMock.findById.mockResolvedValueOnce(
        makeRide({ status: ERideStatus.ENROUTE }),
      );
      const res = await service.transitionRideStatus(
        'rid',
        [ERideStatus.REQUESTED],
        ERideStatus.ACCEPTED,
      );
      expect(res.changed).toBe(false);
    });

    it('skips when already in next status', async () => {
      rideRepoMock.findById.mockResolvedValueOnce(
        makeRide({ status: ERideStatus.ACCEPTED }),
      );
      const res = await service.transitionRideStatus(
        'rid',
        [ERideStatus.ACCEPTED],
        ERideStatus.ACCEPTED,
      );
      expect(res.changed).toBe(false);
    });

    it('changes status, records history (with cancel context)', async () => {
      const initial = makeRide({ status: ERideStatus.REQUESTED });
      rideRepoMock.findById.mockResolvedValueOnce(initial);

      const res = await service.transitionRideStatus(
        'rid',
        [ERideStatus.REQUESTED],
        ERideStatus.CANCELED,
        'ctx',
      );

      expect(res.changed).toBe(true);
      expect(res.ride.status).toBe(ERideStatus.CANCELED);
      expect(historyRepoMock.create).toHaveBeenCalledWith(
        expect.objectContaining({
          toStatus: ERideStatus.CANCELED,
          context: 'ctx',
        }),
      );
    });

    it('throws NotFound when ride missing', async () => {
      rideRepoMock.findById.mockResolvedValueOnce(null);
      await expect(
        service.transitionRideStatus(
          'rid',
          [ERideStatus.REQUESTED],
          ERideStatus.ACCEPTED,
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
