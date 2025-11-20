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
  });
});
