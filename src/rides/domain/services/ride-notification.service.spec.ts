import { Logger } from '@nestjs/common';
import { RideNotificationService } from './ride-notification.service';
import { NotificationPublisher } from '../../../notifications/domain/ports/notification-publisher.port';
import { Ride } from '../entities/ride.entity';
import { RideDriverCandidate } from '../entities/ride-driver-candidate.entity';
import { RouteEstimates } from './rides-management.service';

describe('RideNotificationService', () => {
  let notificationPublisher: jest.Mocked<NotificationPublisher>;
  let service: RideNotificationService;
  const ride: Ride = {
    id: 'ride-1',
    riderId: 'rider-1',
    driverId: 'driver-1',
    status: 'requested',
  } as Ride;

  const candidate: RideDriverCandidate = {
    driverId: 'driver-1',
    status: 'invited',
    reason: null,
    distanceMeters: 100,
    respondedAt: null,
    createdAt: new Date('2023-01-01T00:00:00Z'),
  } as RideDriverCandidate;

  beforeEach(() => {
    notificationPublisher = {
      emit: jest.fn(),
    } as unknown as jest.Mocked<NotificationPublisher>;
    service = new RideNotificationService(notificationPublisher);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('warns and skips notifications when target id is missing', async () => {
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();

    await service['dispatchNotification'](
      'driver',
      '',
      'event',
      ride,
      'message',
    );

    expect(notificationPublisher.emit).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      'Skipping notification for driver with missing identifier: message',
    );
  });

  it('notifies ride offered with candidate and route data and logs queued message when undelivered', async () => {
    const debugSpy = jest.spyOn(Logger.prototype, 'debug').mockImplementation();
    const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    notificationPublisher.emit.mockResolvedValueOnce(false);

    const route: RouteEstimates = { distanceKm: 1.2, durationSeconds: 120 };
    await service.notifyRideOffered(ride, candidate, route);

    expect(notificationPublisher.emit).toHaveBeenCalledWith(
      'driver',
      candidate.driverId,
      'ride.offer',
      expect.objectContaining({
        rideId: ride.id,
        candidate: expect.objectContaining({ driverId: candidate.driverId }),
        route,
      }),
    );
    expect(debugSpy).toHaveBeenCalledWith(
      `No active SSE clients for driver ${candidate.driverId}. Queued notification: New ride requested near you`,
    );
    expect(logSpy).toHaveBeenCalled();
  });

  it('notifies rider and driver when ride starts and handles missing driver id', async () => {
    const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    notificationPublisher.emit.mockResolvedValue(true);

    const riderOnlyRide = { ...ride, driverId: null } as Ride;
    await service.notifyRideStarted(riderOnlyRide);
    expect(notificationPublisher.emit).toHaveBeenCalledWith(
      'rider',
      ride.riderId,
      'ride.started.rider',
      expect.objectContaining({ riderId: ride.riderId }),
    );

    notificationPublisher.emit.mockClear();
    await service.notifyRideStarted(ride);
    expect(notificationPublisher.emit).toHaveBeenNthCalledWith(
      1,
      'rider',
      ride.riderId,
      'ride.started.rider',
      expect.any(Object),
    );
    expect(notificationPublisher.emit).toHaveBeenNthCalledWith(
      2,
      'driver',
      ride.driverId!,
      'ride.started.driver',
      expect.any(Object),
    );
    expect(logSpy).toHaveBeenCalled();
  });
});
