// src/rides/domain/services/ride-notification.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { RideNotificationService } from './ride-notification.service';
import {
  NOTIFICATION_PUBLISHER,
  NotificationPublisher,
} from '../../../notifications/domain/ports/notification-publisher.port';
import { Ride } from '../entities/ride.entity';
import { ERideStatus } from '../constants/ride-status.enum';
import { RideDriverCandidate } from '../entities/ride-driver-candidate.entity';
import { ERideDriverCandidateStatus } from '../constants/ride-driver-candidate-status.enum';
import type { RouteEstimates } from './rides-management.service';

describe('RideNotificationService', () => {
  let service: RideNotificationService;
  let publisherMock: jest.Mocked<NotificationPublisher>;

  const makeRide = (over: Partial<Ride> = {}): Ride => {
    const r = new Ride();
    r.id = 'ride-1';
    r.riderId = 'r-1';
    r.driverId = 'd-1';
    r.status = ERideStatus.CANDIDATES_COMPUTED;
    Object.assign(r, over);
    return r;
  };

  const makeCandidate = (
    over: Partial<RideDriverCandidate> = {},
  ): RideDriverCandidate => {
    const c = new RideDriverCandidate();
    c.driverId = 'd-1';
    c.status = ERideDriverCandidateStatus.INVITED;
    c.reason = null;
    c.distanceMeters = 123;
    c.respondedAt = new Date('2025-01-01T00:01:00.000Z');
    c.createdAt = new Date('2025-01-01T00:00:30.000Z');
    Object.assign(c, over);
    return c;
  };

  const makeRoute = (): RouteEstimates => ({
    distanceKm: 2.34,
    durationSeconds: 420,
  });

  beforeEach(async () => {
    publisherMock = {
      emit: jest.fn().mockResolvedValue(true),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RideNotificationService,
        {
          provide: NOTIFICATION_PUBLISHER,
          useValue: publisherMock,
        },
      ],
    }).compile();

    service = module.get(RideNotificationService);

    // silence logs to keep test output clean
    jest.spyOn(service['logger'], 'log').mockImplementation();
    jest.spyOn(service['logger'], 'debug').mockImplementation();
    jest.spyOn(service['logger'], 'warn').mockImplementation();
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  //
  // notifyRideMatched
  //
  describe('notifyRideMatched', () => {
    it('sends rider notification "ride.candidates.invited"', async () => {
      const ride = makeRide();

      await service.notifyRideMatched(ride);

      expect(publisherMock.emit).toHaveBeenCalledTimes(1);
      expect(publisherMock.emit).toHaveBeenCalledWith(
        'rider',
        'r-1',
        'ride.candidates.invited',
        expect.objectContaining({
          rideId: 'ride-1',
          riderId: 'r-1',
          driverId: 'd-1',
          status: ERideStatus.CANDIDATES_COMPUTED,
          message: 'awaiting driver responses',
        }),
      );
    });
  });

  //
  // notifyRideOffered
  //
  describe('notifyRideOffered', () => {
    it('sends driver "ride.offer" with candidate + route', async () => {
      const ride = makeRide();
      const cand = makeCandidate();
      const route = makeRoute();

      await service.notifyRideOffered(ride, cand, route);

      expect(publisherMock.emit).toHaveBeenCalledTimes(1);
      expect(publisherMock.emit).toHaveBeenCalledWith(
        'driver',
        'd-1',
        'ride.offer',
        expect.objectContaining({
          rideId: 'ride-1',
          message: 'New ride requested near you',
          candidate: {
            driverId: 'd-1',
            status: ERideDriverCandidateStatus.INVITED,
            reason: null,
            distanceMeters: 123,
            respondedAt: '2025-01-01T00:01:00.000Z',
            createdAt: '2025-01-01T00:00:30.000Z',
          },
          route,
        }),
      );
    });
    it('call dispatchNotification with apropriate data ', async () => {
      const ride = makeRide();
      const cand = makeCandidate({
        distanceMeters: null,
        respondedAt: null,
        createdAt: undefined,
      });
      const route = makeRoute();

      const spy = jest
        .spyOn<any, any>(service as any, 'dispatchNotification')
        .mockResolvedValue(undefined); // stubbed: no real publish

      await service.notifyRideOffered(ride, cand, route);

      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith(
        'driver',
        'd-1',
        'ride.offer',
        ride,
        'New ride requested near you',
        {
          candidate: {
            driverId: 'd-1',
            status: ERideDriverCandidateStatus.INVITED,
            reason: null,
            distanceMeters: 123,
            respondedAt: '2025-01-01T00:01:00.000Z',
            createdAt: '2025-01-01T00:00:30.000Z',
          },
          route: { distanceKm: 2.34, durationSeconds: 420 },
        },
      );

      // Do NOT assert publisherMock.emit here, since we stubbed dispatchNotification
    });
  });

  //
  // notifyDriverAccepted / Declined
  //
  describe('notifyDriverAccepted / notifyDriverDeclined', () => {
    it('sends rider "ride.driver.accepted"', async () => {
      const ride = makeRide();
      const cand = makeCandidate();

      await service.notifyDriverAccepted(ride, cand);

      expect(publisherMock.emit).toHaveBeenCalledTimes(1);
      expect(publisherMock.emit).toHaveBeenCalledWith(
        'rider',
        'r-1',
        'ride.driver.accepted',
        expect.objectContaining({
          rideId: 'ride-1',
          message: `Driver d-1 accepted ride ride-1`,
          candidate: expect.objectContaining({ driverId: 'd-1' }),
        }),
      );
    });

    it('sends rider "ride.driver.declined"', async () => {
      const ride = makeRide();
      const cand = makeCandidate({
        status: ERideDriverCandidateStatus.DECLINED,
        reason: 'busy',
      });

      await service.notifyDriverDeclined(ride, cand);

      expect(publisherMock.emit).toHaveBeenCalledTimes(1);
      expect(publisherMock.emit).toHaveBeenCalledWith(
        'rider',
        'r-1',
        'ride.driver.declined',
        expect.objectContaining({
          rideId: 'ride-1',
          message: `Driver d-1 declined ride ride-1`,
          candidate: expect.objectContaining({
            status: ERideDriverCandidateStatus.DECLINED,
            reason: 'busy',
          }),
        }),
      );
    });
  });

  //
  // notifyRiderConfirmed
  //
  describe('notifyRiderConfirmed', () => {
    it('no-op when ride has no driverId', async () => {
      const ride = makeRide({ driverId: undefined });
      const cand = makeCandidate();

      await service.notifyRiderConfirmed(ride, cand);
      expect(publisherMock.emit).not.toHaveBeenCalled();
    });

    it('sends driver "ride.rider.confirmed" when driverId present', async () => {
      const ride = makeRide({ driverId: 'd-9' });
      const cand = makeCandidate({ driverId: 'd-9' });

      await service.notifyRiderConfirmed(ride, cand);

      expect(publisherMock.emit).toHaveBeenCalledTimes(1);
      expect(publisherMock.emit).toHaveBeenCalledWith(
        'driver',
        'd-9',
        'ride.rider.confirmed',
        expect.objectContaining({
          rideId: 'ride-1',
          riderId: 'r-1',
          status: ERideStatus.CANDIDATES_COMPUTED,
          message: 'Rider r-1 confirmed ride ride-1',
          candidate: expect.objectContaining({ driverId: 'd-9' }),
        }),
      );
    });
  });

  //
  // notifyRiderRejectedDriver
  //
  describe('notifyRiderRejectedDriver', () => {
    it('includes reason when provided', async () => {
      const ride = makeRide({ riderId: 'r-7' });
      const cand = makeCandidate({ driverId: 'd-7' });

      await service.notifyRiderRejectedDriver(ride, cand, 'too far');

      expect(publisherMock.emit).toHaveBeenCalledTimes(1);
      expect(publisherMock.emit).toHaveBeenCalledWith(
        'driver',
        'd-7',
        'ride.rider.rejected',
        expect.objectContaining({
          rideId: 'ride-1',
          message: `Rider r-7 rejected ride ride-1: too far`,
          rejectionReason: 'too far',
          candidate: expect.objectContaining({ driverId: 'd-7' }),
        }),
      );
    });

    it('omits reason when not provided (null)', async () => {
      const ride = makeRide({ riderId: 'r-8' });
      const cand = makeCandidate({ driverId: 'd-8' });

      await service.notifyRiderRejectedDriver(ride, cand);

      expect(publisherMock.emit).toHaveBeenCalledTimes(1);
      expect(publisherMock.emit).toHaveBeenCalledWith(
        'driver',
        'd-8',
        'ride.rider.rejected',
        expect.objectContaining({
          rideId: 'ride-1',
          message: `Rider r-8 rejected ride ride-1`,
          rejectionReason: null,
          candidate: expect.objectContaining({
            driverId: 'd-8',
          }),
        }),
      );
    });
  });

  //
  // notifyCandidateSuperseded
  //
  describe('notifyCandidateSuperseded', () => {
    it('sends not_selected to driver', async () => {
      const ride = makeRide({ id: 'ride-x' });
      const cand = makeCandidate({ driverId: 'd-x' });

      await service.notifyCandidateSuperseded(ride, cand);

      expect(publisherMock.emit).toHaveBeenCalledTimes(1);
      expect(publisherMock.emit).toHaveBeenCalledWith(
        'driver',
        'd-x',
        'ride.driver.not_selected',
        expect.objectContaining({
          rideId: 'ride-x',
          message: `Ride ride-x is no longer available`,
          candidate: expect.objectContaining({ driverId: 'd-x' }),
        }),
      );
    });
  });

  //
  // notifyRideCanceledForCandidate
  //
  describe('notifyRideCanceledForCandidate', () => {
    it('with reason', async () => {
      const ride = makeRide({ id: 'rid-9', riderId: 'r-9' });
      const cand = makeCandidate({ driverId: 'd-9' });

      await service.notifyRideCanceledForCandidate(ride, cand, 'rain');

      expect(publisherMock.emit).toHaveBeenCalledTimes(1);
      expect(publisherMock.emit).toHaveBeenCalledWith(
        'driver',
        'd-9',
        'ride.cancelled',
        expect.objectContaining({
          rideId: 'rid-9',
          message: `Ride rid-9 was cancelled by rider r-9: rain`,
          cancellationReason: 'rain',
          candidate: expect.objectContaining({ driverId: 'd-9' }),
        }),
      );
    });

    it('without reason', async () => {
      const ride = makeRide({ id: 'rid-10', riderId: 'r-10' });
      const cand = makeCandidate({ driverId: 'd-10' });

      await service.notifyRideCanceledForCandidate(ride, cand);

      expect(publisherMock.emit).toHaveBeenCalledTimes(1);
      expect(publisherMock.emit).toHaveBeenCalledWith(
        'driver',
        'd-10',
        'ride.cancelled',
        expect.objectContaining({
          rideId: 'rid-10',
          message: `Ride rid-10 was cancelled by rider r-10`,
          cancellationReason: null,
          candidate: expect.objectContaining({ driverId: 'd-10' }),
        }),
      );
    });
  });

  //
  // notifyRideStarted
  //
  describe('notifyRideStarted', () => {
    it('no driverId: only rider event', async () => {
      const ride = makeRide({ driverId: undefined, id: 'rid-a' });

      await service.notifyRideStarted(ride);

      expect(publisherMock.emit).toHaveBeenCalledTimes(1);
      expect(publisherMock.emit).toHaveBeenCalledWith(
        'rider',
        'r-1',
        'ride.started.rider',
        expect.objectContaining({
          rideId: 'rid-a',
          message: `Ride rid-a has started.`,
        }),
      );
    });

    it('with driverId: rider + driver events (emit returns false to hit debug)', async () => {
      publisherMock.emit.mockResolvedValueOnce(false); // rider emit returns false
      const ride = makeRide({ id: 'rid-b', driverId: 'd-b' });

      await service.notifyRideStarted(ride);

      expect(publisherMock.emit).toHaveBeenCalledTimes(2);
      expect(publisherMock.emit).toHaveBeenNthCalledWith(
        1,
        'rider',
        'r-1',
        'ride.started.rider',
        expect.objectContaining({
          rideId: 'rid-b',
          message: `Ride rid-b has started.`,
        }),
      );
      expect(publisherMock.emit).toHaveBeenNthCalledWith(
        2,
        'driver',
        'd-b',
        'ride.started.driver',
        expect.objectContaining({
          rideId: 'rid-b',
          message: `Ride rid-b is now in progress.`,
        }),
      );
    });
  });

  //
  // notifyRideCompleted
  //
  describe('notifyRideCompleted', () => {
    const summary = {
      baseFare: '7000.00',
      discountPercent: 10,
      discountAmount: '700.00',
      finalFare: '6300.00',
      appFee: '500.00',
    };

    it('no driverId: only rider completed', async () => {
      const ride = makeRide({ id: 'rid-c', driverId: undefined });

      await service.notifyRideCompleted(ride, summary);

      expect(publisherMock.emit).toHaveBeenCalledTimes(1);
      expect(publisherMock.emit).toHaveBeenCalledWith(
        'rider',
        'r-1',
        'ride.completed.rider',
        expect.objectContaining({
          rideId: 'rid-c',
          message: `Ride rid-c completed. Fare due: Rp 6300.00.`,
          summary,
        }),
      );
    });

    it('with driverId: rider + driver completed', async () => {
      const ride = makeRide({ id: 'rid-d', driverId: 'd-d' });

      await service.notifyRideCompleted(ride, summary);

      expect(publisherMock.emit).toHaveBeenCalledTimes(2);
      expect(publisherMock.emit).toHaveBeenNthCalledWith(
        1,
        'rider',
        'r-1',
        'ride.completed.rider',
        expect.objectContaining({
          rideId: 'rid-d',
          message: `Ride rid-d completed. Fare due: Rp 6300.00.`,
          summary,
        }),
      );
      expect(publisherMock.emit).toHaveBeenNthCalledWith(
        2,
        'driver',
        'd-d',
        'ride.completed.driver',
        expect.objectContaining({
          rideId: 'rid-d',
          message: `Ride rid-d completed. Fare: Rp 6300.00.`,
          summary,
        }),
      );
    });
  });

  //
  // notifyRidePaid
  //
  describe('notifyRidePaid', () => {
    it('no driverId: only rider notified (no paymentReference)', async () => {
      const ride = makeRide({ id: 'rid-p', driverId: undefined });

      await service.notifyRidePaid(ride);

      expect(publisherMock.emit).toHaveBeenCalledTimes(1);
      expect(publisherMock.emit).toHaveBeenCalledWith(
        'rider',
        'r-1',
        'ride.payment.completed.rider',
        expect.objectContaining({
          rideId: 'rid-p',
          message: `Payment for ride rid-p confirmed.`,
        }),
      );
    });

    it('with driverId and paymentReference: rider + driver notified with extras', async () => {
      const ride = makeRide({ id: 'rid-q', driverId: 'd-q' });

      await service.notifyRidePaid(ride, 'PAY-123');

      expect(publisherMock.emit).toHaveBeenCalledTimes(2);
      expect(publisherMock.emit).toHaveBeenNthCalledWith(
        1,
        'rider',
        'r-1',
        'ride.payment.completed.rider',
        expect.objectContaining({
          rideId: 'rid-q',
          message: `Payment for ride rid-q confirmed.`,
          paymentReference: 'PAY-123',
        }),
      );
      expect(publisherMock.emit).toHaveBeenNthCalledWith(
        2,
        'driver',
        'd-q',
        'ride.payment.completed.driver',
        expect.objectContaining({
          rideId: 'rid-q',
          message: `Ride rid-q payment has been received.`,
          paymentReference: 'PAY-123',
        }),
      );
    });
  });

  //
  // dispatchNotification (internal) edge cases
  //
  describe('dispatchNotification (internal) edge cases', () => {
    it('skips when targetId missing', async () => {
      await (service as any).dispatchNotification(
        'rider',
        '', // missing id
        'evt',
        makeRide(),
        'msg',
        {},
      );
      expect(publisherMock.emit).not.toHaveBeenCalled();
      expect(service['logger'].warn).toHaveBeenCalled();
    });

    it('payload building for generic object without id', async () => {
      await (service as any).dispatchNotification(
        'rider',
        'r-x',
        'evt-x',
        { extra: 1 }, // no id
        'hello',
        { foo: 'bar' },
      );
      expect(publisherMock.emit).toHaveBeenCalledTimes(1);
      expect(publisherMock.emit).toHaveBeenCalledWith(
        'rider',
        'r-x',
        'evt-x',
        expect.objectContaining({
          rideId: undefined,
          message: 'hello',
          foo: 'bar',
          extra: 1,
        }),
      );
    });

    it('payload building for Ride entity with null driverId', async () => {
      const ride = makeRide({ driverId: null });
      await (service as any).dispatchNotification(
        'driver',
        'd-1',
        'evt-y',
        ride,
        'hi',
        {},
      );
      expect(publisherMock.emit).toHaveBeenCalledTimes(1);
      expect(publisherMock.emit).toHaveBeenCalledWith(
        'driver',
        'd-1',
        'evt-y',
        expect.objectContaining({
          rideId: 'ride-1',
          riderId: 'r-1',
          driverId: null,
          status: ERideStatus.CANDIDATES_COMPUTED,
          message: 'hi',
        }),
      );
    });

    it('logs debug when emit returns false', async () => {
      publisherMock.emit.mockResolvedValueOnce(false);
      await (service as any).dispatchNotification(
        'rider',
        'r-1',
        'evt-z',
        makeRide(),
        'msg-z',
        {},
      );
      expect(publisherMock.emit).toHaveBeenCalledTimes(1);
      expect(service['logger'].debug).toHaveBeenCalled();
    });
  });
});
