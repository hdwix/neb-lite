import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RidesTrackingService } from './rides-tracking.service';
import { RideRepository } from '../../infrastructure/repositories/ride.repository';
import {
  TripTrackingService,
  ParticipantLocation,
} from './trip-tracking.service';
import { RideNotificationService } from './ride-notification.service';
import {
  RidesManagementService,
  RequestingClient,
} from './rides-management.service';
import { FareEngineService } from './fare-engine.service';
import { ERideStatus } from '../constants/ride-status.enum';
import { EClientType } from '../../../app/enums/client-type.enum';
import { ERidePaymentStatus } from '../constants/ride-payment-status.enum';

describe('RidesTrackingService', () => {
  let rideRepository: jest.Mocked<RideRepository>;
  let tripTrackingService: jest.Mocked<TripTrackingService>;
  let notificationService: jest.Mocked<RideNotificationService>;
  let ridesManagementService: jest.Mocked<RidesManagementService>;
  let fareEngine: jest.Mocked<FareEngineService>;
  let configService: jest.Mocked<ConfigService>;
  let service: RidesTrackingService;

  const baseRide = {
    id: 'ride-1',
    riderId: 'rider-1',
    driverId: 'driver-1',
    status: ERideStatus.ENROUTE,
    pickupLongitude: 1,
    pickupLatitude: 1,
    dropoffLongitude: 2,
    dropoffLatitude: 2,
  } as any;

  const driverLocation: ParticipantLocation = {
    longitude: 1,
    latitude: 1,
    recordedAt: 'now',
  };

  beforeEach(() => {
    rideRepository = {
      findById: jest.fn(),
      updateRide: jest.fn(),
    } as any;
    tripTrackingService = {
      getLatestLocation: jest.fn(),
      recordLocation: jest.fn(),
      getTotalDistanceMeters: jest.fn(),
      markRideCompleted: jest.fn(),
      calculateDistanceBetweenCoordinates: jest.fn().mockResolvedValue(0),
    } as any;
    notificationService = {
      notifyRideStarted: jest.fn(),
      notifyRideCompleted: jest.fn(),
    } as any;
    ridesManagementService = {
      transitionRideStatus: jest.fn(),
      ensureRequesterCanAccessRide: jest.fn(),
    } as any;
    fareEngine = {
      calculateFare: jest.fn().mockReturnValue({
        roundedDistanceKm: 1,
        discountPercent: 0,
        discountAmount: 0,
        finalFare: 10,
        baseFare: 10,
        appFeeAmount: 1,
      }),
    } as any;
    configService = {
      get: jest.fn().mockReturnValue(30),
    } as any;

    service = new RidesTrackingService(
      rideRepository,
      tripTrackingService,
      notificationService,
      ridesManagementService,
      fareEngine,
      configService,
    );
  });

  describe('startRide', () => {
    it('validates presence and ownership', async () => {
      await expect(
        service.startRide('ride-1', '', driverLocation),
      ).rejects.toBeInstanceOf(BadRequestException);

      rideRepository.findById.mockResolvedValue(null);
      await expect(
        service.startRide('ride-1', 'driver-1', driverLocation),
      ).rejects.toBeInstanceOf(NotFoundException);

      rideRepository.findById.mockResolvedValue({
        ...baseRide,
        driverId: 'other',
      });
      await expect(
        service.startRide('ride-1', 'driver-1', driverLocation),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects invalid ride states', async () => {
      rideRepository.findById.mockResolvedValue({
        ...baseRide,
        status: ERideStatus.CANCELED,
      });
      await expect(
        service.startRide('ride-1', 'driver-1', driverLocation),
      ).rejects.toBeInstanceOf(BadRequestException);

      rideRepository.findById.mockResolvedValue({
        ...baseRide,
        status: ERideStatus.COMPLETED,
      });
      await expect(
        service.startRide('ride-1', 'driver-1', driverLocation),
      ).rejects.toBeInstanceOf(BadRequestException);

      rideRepository.findById.mockResolvedValue({
        ...baseRide,
        status: ERideStatus.ASSIGNED,
      });
      await expect(
        service.startRide('ride-1', 'driver-1', driverLocation),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('requires rider location and proximity', async () => {
      rideRepository.findById.mockResolvedValue(baseRide);
      tripTrackingService.getLatestLocation.mockResolvedValue(null);

      await expect(
        service.startRide('ride-1', 'driver-1', driverLocation),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws when participants are not within required proximity', async () => {
      rideRepository.findById.mockResolvedValue(baseRide);
      tripTrackingService.getLatestLocation.mockResolvedValue(driverLocation);
      tripTrackingService.calculateDistanceBetweenCoordinates
        .mockResolvedValueOnce(50) // driver not at pickup
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(100); // participants not nearby

      await expect(
        service.startRide('ride-1', 'driver-1', driverLocation),
      ).rejects.toBeInstanceOf(BadRequestException);

      tripTrackingService.calculateDistanceBetweenCoordinates.mockResolvedValueOnce(
        0,
      );

      rideRepository.findById.mockResolvedValue(baseRide);
      tripTrackingService.getLatestLocation.mockResolvedValue(driverLocation);
      tripTrackingService.calculateDistanceBetweenCoordinates
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(100);

      await expect(
        service.startRide('ride-1', 'driver-1', driverLocation),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('starts ride and notifies when transitioned', async () => {
      rideRepository.findById
        .mockResolvedValueOnce(baseRide)
        .mockResolvedValueOnce({
          ...baseRide,
          status: ERideStatus.TRIP_STARTED,
        });
      tripTrackingService.getLatestLocation.mockResolvedValue(driverLocation);
      tripTrackingService.calculateDistanceBetweenCoordinates.mockResolvedValue(
        0,
      );
      ridesManagementService.transitionRideStatus.mockResolvedValue({
        ride: { ...baseRide, status: ERideStatus.TRIP_STARTED },
        changed: true,
      });

      const ride = await service.startRide(
        'ride-1',
        'driver-1',
        driverLocation,
      );

      expect(tripTrackingService.recordLocation).toHaveBeenCalledWith(
        'ride-1',
        'driver-1',
        EClientType.DRIVER,
        driverLocation,
      );
      expect(notificationService.notifyRideStarted).toHaveBeenCalled();
      expect(ride.status).toBe(ERideStatus.TRIP_STARTED);
    });

    it('returns refreshed ride without notifying when status unchanged', async () => {
      rideRepository.findById
        .mockResolvedValueOnce(baseRide)
        .mockResolvedValueOnce(null);
      tripTrackingService.getLatestLocation.mockResolvedValue(driverLocation);
      tripTrackingService.calculateDistanceBetweenCoordinates.mockResolvedValue(
        0,
      );
      ridesManagementService.transitionRideStatus.mockResolvedValue({
        ride: { ...baseRide, status: ERideStatus.TRIP_STARTED },
        changed: false,
      });

      const ride = await service.startRide(
        'ride-1',
        'driver-1',
        driverLocation,
      );

      expect(ride.status).toBe(ERideStatus.TRIP_STARTED);
      expect(notificationService.notifyRideStarted).not.toHaveBeenCalled();
    });
  });

  describe('recordTripLocation', () => {
    const requester: RequestingClient = {
      id: 'client-1',
      role: EClientType.DRIVER,
    };

    it('validates requester and ride access', async () => {
      await expect(
        service.recordTripLocation('ride-1', { id: '' } as any, driverLocation),
      ).rejects.toBeInstanceOf(BadRequestException);

      rideRepository.findById.mockResolvedValue(null);
      await expect(
        service.recordTripLocation('ride-1', requester, driverLocation),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects cancelled or completed rides', async () => {
      rideRepository.findById.mockResolvedValue({
        ...baseRide,
        status: ERideStatus.CANCELED,
      });
      await expect(
        service.recordTripLocation('ride-1', requester, driverLocation),
      ).rejects.toBeInstanceOf(BadRequestException);

      rideRepository.findById.mockResolvedValue({
        ...baseRide,
        status: ERideStatus.COMPLETED,
      });
      await expect(
        service.recordTripLocation('ride-1', requester, driverLocation),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('requires requester role and driver ownership', async () => {
      rideRepository.findById.mockResolvedValue(baseRide);
      await expect(
        service.recordTripLocation(
          'ride-1',
          { id: 'client-1' } as any,
          driverLocation,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);

      await expect(
        service.recordTripLocation(
          'ride-1',
          { id: 'wrong', role: EClientType.DRIVER },
          driverLocation,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects missing requester role before recording location', async () => {
      rideRepository.findById.mockResolvedValue(baseRide);

      await expect(
        service.recordTripLocation('ride-1', { id: 'client-1' } as any, {
          longitude: 0,
          latitude: 0,
        } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('records driver and rider locations based on role', async () => {
      rideRepository.findById.mockResolvedValue(baseRide);

      await service.recordTripLocation(
        'ride-1',
        { id: baseRide.driverId, role: EClientType.DRIVER },
        driverLocation,
      );
      expect(tripTrackingService.recordLocation).toHaveBeenCalledWith(
        'ride-1',
        baseRide.driverId,
        EClientType.DRIVER,
        driverLocation,
      );

      await service.recordTripLocation(
        'ride-1',
        { id: baseRide.riderId, role: EClientType.RIDER },
        driverLocation,
      );
      expect(tripTrackingService.recordLocation).toHaveBeenCalledWith(
        'ride-1',
        baseRide.riderId,
        EClientType.RIDER,
        driverLocation,
      );
    });

    it('rejects unsupported role', async () => {
      rideRepository.findById.mockResolvedValue(baseRide);

      await expect(
        service.recordTripLocation(
          'ride-1',
          { id: 'x', role: 'other' as any },
          driverLocation,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('completeRide', () => {
    const requester: RequestingClient = {
      id: 'driver-1',
      role: EClientType.DRIVER,
    };

    it('validates requester and ride existence', async () => {
      await expect(
        service.completeRide('ride-1', { id: '' } as any, { driverLocation }),
      ).rejects.toBeInstanceOf(BadRequestException);

      rideRepository.findById.mockResolvedValue(null);
      await expect(
        service.completeRide('ride-1', requester, { driverLocation }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects invalid states and missing rider location', async () => {
      rideRepository.findById.mockResolvedValue({
        ...baseRide,
        driverId: 'other',
      });
      await expect(
        service.completeRide('ride-1', requester, { driverLocation }),
      ).rejects.toBeInstanceOf(NotFoundException);

      rideRepository.findById.mockResolvedValue({
        ...baseRide,
        status: ERideStatus.CANCELED,
      });
      await expect(
        service.completeRide('ride-1', requester, { driverLocation }),
      ).rejects.toBeInstanceOf(BadRequestException);

      rideRepository.findById.mockResolvedValue({
        ...baseRide,
        status: ERideStatus.COMPLETED,
      });
      await expect(
        service.completeRide('ride-1', requester, { driverLocation }),
      ).rejects.toBeInstanceOf(BadRequestException);

      rideRepository.findById.mockResolvedValue(baseRide);
      tripTrackingService.getLatestLocation.mockResolvedValue(null);
      await expect(
        service.completeRide('ride-1', requester, { driverLocation }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('completes ride, calculates fare, and notifies', async () => {
      rideRepository.findById
        .mockResolvedValueOnce(baseRide)
        .mockResolvedValueOnce({
          ...baseRide,
          status: ERideStatus.COMPLETED,
          paymentStatus: ERidePaymentStatus.PENDING,
          paymentUrl: null,
        });
      tripTrackingService.getLatestLocation.mockResolvedValue(driverLocation);
      tripTrackingService.getTotalDistanceMeters.mockResolvedValue(2000);
      tripTrackingService.calculateDistanceBetweenCoordinates.mockResolvedValue(
        0,
      );
      ridesManagementService.transitionRideStatus.mockResolvedValue({
        ride: { ...baseRide, status: ERideStatus.COMPLETED },
        changed: true,
      });
      rideRepository.updateRide.mockImplementation(async (ride) => ride);

      const ride = await service.completeRide('ride-1', requester, {
        driverLocation,
      });

      expect(tripTrackingService.markRideCompleted).toHaveBeenCalledWith(
        'ride-1',
      );
      expect(ride.paymentStatus).toBe(ERidePaymentStatus.PENDING);
      expect(notificationService.notifyRideCompleted).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({ finalFare: '10.00' }),
      );
    });

    it('rejects completion when participants are not at dropoff together', async () => {
      rideRepository.findById.mockResolvedValue(baseRide);
      tripTrackingService.getLatestLocation.mockResolvedValue(driverLocation);
      tripTrackingService.calculateDistanceBetweenCoordinates
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(150);

      await expect(
        service.completeRide('ride-1', requester, { driverLocation }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('falls back to ride distance when total distance is invalid', async () => {
      const rideWithDistance = {
        ...baseRide,
        distanceActualKm: 5.5,
        distanceEstimatedKm: 4,
      };

      rideRepository.findById
        .mockResolvedValueOnce(rideWithDistance)
        .mockResolvedValueOnce({
          ...rideWithDistance,
          status: ERideStatus.COMPLETED,
          paymentStatus: ERidePaymentStatus.PENDING,
          paymentUrl: null,
        });
      tripTrackingService.getLatestLocation.mockResolvedValue(driverLocation);
      tripTrackingService.getTotalDistanceMeters.mockResolvedValue(Number.NaN);
      tripTrackingService.calculateDistanceBetweenCoordinates.mockResolvedValue(
        0,
      );
      ridesManagementService.transitionRideStatus.mockResolvedValue({
        ride: { ...rideWithDistance, status: ERideStatus.COMPLETED },
        changed: true,
      });
      rideRepository.updateRide.mockImplementation(async (ride) => ride);

      await service.completeRide('ride-1', requester, { driverLocation });

      expect(fareEngine.calculateFare).toHaveBeenCalledWith(
        expect.objectContaining({ distanceKm: 5.5 }),
      );
    });

    it('uses estimated distance when actual distance is missing', async () => {
      const rideWithEstimatedDistance = {
        ...baseRide,
        distanceEstimatedKm: 6.2,
        distanceActualKm: undefined,
      } as any;

      rideRepository.findById
        .mockResolvedValueOnce(rideWithEstimatedDistance)
        .mockResolvedValueOnce({
          ...rideWithEstimatedDistance,
          status: ERideStatus.COMPLETED,
          paymentStatus: ERidePaymentStatus.PENDING,
          paymentUrl: null,
        });
      tripTrackingService.getLatestLocation.mockResolvedValue(driverLocation);
      tripTrackingService.getTotalDistanceMeters.mockResolvedValue(0);
      tripTrackingService.calculateDistanceBetweenCoordinates.mockResolvedValue(0);
      ridesManagementService.transitionRideStatus.mockResolvedValue({
        ride: { ...rideWithEstimatedDistance, status: ERideStatus.COMPLETED },
        changed: true,
      });
      rideRepository.updateRide.mockImplementation(async (ride) => ride);

      await service.completeRide('ride-1', requester, { driverLocation });

      expect(fareEngine.calculateFare).toHaveBeenCalledWith(
        expect.objectContaining({ distanceKm: 6.2 }),
      );
    });

    it('defaults to zero distance when no ride distances are available', async () => {
      const rideWithoutDistances = {
        ...baseRide,
        distanceEstimatedKm: undefined,
        distanceActualKm: undefined,
      } as any;

      rideRepository.findById
        .mockResolvedValueOnce(rideWithoutDistances)
        .mockResolvedValueOnce({
          ...rideWithoutDistances,
          status: ERideStatus.COMPLETED,
          paymentStatus: ERidePaymentStatus.PENDING,
          paymentUrl: null,
        });
      tripTrackingService.getLatestLocation.mockResolvedValue(driverLocation);
      tripTrackingService.getTotalDistanceMeters.mockResolvedValue(-100);
      tripTrackingService.calculateDistanceBetweenCoordinates.mockResolvedValue(0);
      ridesManagementService.transitionRideStatus.mockResolvedValue({
        ride: { ...rideWithoutDistances, status: ERideStatus.COMPLETED },
        changed: true,
      });
      rideRepository.updateRide.mockImplementation(async (ride) => ride);

      await service.completeRide('ride-1', requester, { driverLocation });

      expect(fareEngine.calculateFare).toHaveBeenCalledWith(
        expect.objectContaining({ distanceKm: 0 }),
      );
    });

    it('uses calculated distance and preserves updated ride when refresh missing', async () => {
      rideRepository.findById
        .mockResolvedValueOnce(baseRide)
        .mockResolvedValueOnce(null);
      tripTrackingService.getLatestLocation.mockResolvedValue(driverLocation);
      tripTrackingService.getTotalDistanceMeters.mockResolvedValue(3000);
      tripTrackingService.calculateDistanceBetweenCoordinates.mockResolvedValue(
        0,
      );
      ridesManagementService.transitionRideStatus.mockResolvedValue({
        ride: { ...baseRide, status: ERideStatus.COMPLETED },
        changed: true,
      });
      rideRepository.updateRide.mockImplementation(async (ride) => ride);

      const ride = await service.completeRide('ride-1', requester, {
        driverLocation,
      });

      expect(fareEngine.calculateFare).toHaveBeenCalledWith(
        expect.objectContaining({ distanceKm: 3 }),
      );
      expect(ride.paymentStatus).toBe(ERidePaymentStatus.PENDING);
      expect(rideRepository.findById).toHaveBeenCalledTimes(2);
    });

    it('resets payment link and marks tracking as completed', async () => {
      rideRepository.findById
        .mockResolvedValueOnce({ ...baseRide, paymentUrl: 'existing' })
        .mockResolvedValueOnce({
          ...baseRide,
          paymentStatus: ERidePaymentStatus.PENDING,
          status: ERideStatus.COMPLETED,
          paymentUrl: null,
        });
      tripTrackingService.getLatestLocation.mockResolvedValue(driverLocation);
      tripTrackingService.getTotalDistanceMeters.mockResolvedValue(1500);
      tripTrackingService.calculateDistanceBetweenCoordinates.mockResolvedValue(0);
      ridesManagementService.transitionRideStatus.mockResolvedValue({
        ride: { ...baseRide, status: ERideStatus.COMPLETED },
        changed: true,
      });
      rideRepository.updateRide.mockImplementation(async (ride) => ride);

      const ride = await service.completeRide('ride-1', requester, {
        driverLocation,
      });

      expect(ride.paymentUrl).toBeNull();
      expect(tripTrackingService.markRideCompleted).toHaveBeenCalledWith('ride-1');
    });
  });

  describe('proximity helpers', () => {
    it('throws when a participant is outside the allowed radius', async () => {
      tripTrackingService.calculateDistanceBetweenCoordinates.mockResolvedValueOnce(
        100,
      );

      await expect(
        (service as any).ensureLocationWithinRadius(
          driverLocation,
          { longitude: 0, latitude: 0 },
          50,
          'out of range',
        ),
      ).rejects.toThrow('out of range');
    });

    it('throws when two participants are not nearby one another', async () => {
      tripTrackingService.calculateDistanceBetweenCoordinates.mockResolvedValueOnce(
        75,
      );

      await expect(
        (service as any).ensureParticipantsAreNearby(
          driverLocation,
          { ...driverLocation, longitude: 2 },
          25,
          'too far',
        ),
      ).rejects.toThrow('too far');
    });

    it('delegates distance calculation to the tracking service', async () => {
      tripTrackingService.calculateDistanceBetweenCoordinates.mockResolvedValueOnce(
        12,
      );

      const distance = await (service as any).calculateDistanceMeters(1, 2, 3, 4);

      expect(distance).toBe(12);
      expect(
        tripTrackingService.calculateDistanceBetweenCoordinates,
      ).toHaveBeenCalledWith(
        { longitude: 1, latitude: 2 },
        { longitude: 3, latitude: 4 },
      );
    });
  });

  describe('configuration parsing', () => {
    it('parses numeric strings and falls back to default for invalid values', () => {
      const configGet = jest
        .fn()
        .mockReturnValueOnce('25')
        .mockReturnValueOnce('invalid');

      const configuredService = new RidesTrackingService(
        rideRepository,
        tripTrackingService,
        notificationService,
        ridesManagementService,
        fareEngine,
        { get: configGet } as any,
      );

      expect((configuredService as any).tripStartProximityMeters).toBe(25);
      expect((configuredService as any).tripCompletionProximityMeters).toBe(20);
    });
  });
});
