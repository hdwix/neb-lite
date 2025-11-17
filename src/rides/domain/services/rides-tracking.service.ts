import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RideRepository } from '../../infrastructure/repositories/ride.repository';
import { Ride } from '../entities/ride.entity';
import { ERideStatus } from '../../../app/enums/ride-status.enum';
import { EClientType } from '../../../app/enums/client-type.enum';
import {
  TripTrackingService,
  ParticipantLocation,
} from './trip-tracking.service';
import { RideNotificationService } from './ride-notification.service';
import {
  RidesManagementService,
  RequestingClient,
} from './rides-management.service';
import { ERidePaymentStatus } from '../../../app/enums/ride-payment-status.enum';
import { FareEngineService } from './fare-engine.service';

@Injectable()
export class RidesTrackingService {
  private readonly tripStartProximityMeters: number;
  private readonly tripCompletionProximityMeters: number;

  constructor(
    private readonly rideRepository: RideRepository,
    private readonly tripTrackingService: TripTrackingService,
    private readonly notificationService: RideNotificationService,
    private readonly ridesManagementService: RidesManagementService,
    private readonly fareEngine: FareEngineService,
    private readonly configService: ConfigService,
  ) {
    this.tripStartProximityMeters = this.getNumberConfig(
      'TRIP_START_PROXIMITY_METERS',
      20,
    );
    this.tripCompletionProximityMeters = this.getNumberConfig(
      'TRIP_COMPLETION_PROXIMITY_METERS',
      20,
    );
  }

  async startRide(
    rideId: string,
    driverId: string,
    driverLocation: ParticipantLocation,
  ): Promise<Ride> {
    const ride = await this.rideRepository.findById(rideId);
    if (!ride) {
      throw new NotFoundException('Ride not found');
    }

    if (ride.driverId !== driverId) {
      throw new NotFoundException('Ride not found');
    }

    if (ride.status === ERideStatus.CANCELED) {
      throw new BadRequestException('Cancelled ride cannot be started');
    }

    if (ride.status === ERideStatus.COMPLETED) {
      throw new BadRequestException('Completed ride cannot be started');
    }

    const allowedStatuses = [
      ERideStatus.ACCEPTED,
      ERideStatus.ASSIGNED,
      ERideStatus.ENROUTE,
    ];

    if (!allowedStatuses.includes(ride.status)) {
      throw new BadRequestException('Ride is not ready to start');
    }

    const riderLocation = await this.tripTrackingService.getLatestLocation(
      ride.id,
      EClientType.RIDER,
    );

    if (!riderLocation) {
      throw new BadRequestException(
        'Rider location not available. Please wait for rider to share location.',
      );
    }

    const pickupPoint = {
      longitude: ride.pickupLongitude,
      latitude: ride.pickupLatitude,
    };

    await this.ensureLocationWithinRadius(
      driverLocation,
      pickupPoint,
      this.tripStartProximityMeters,
      'Driver must be at pickup location to start the trip.',
    );
    await this.ensureLocationWithinRadius(
      riderLocation,
      pickupPoint,
      this.tripStartProximityMeters,
      'Rider is not at pickup location. Please confirm rider arrival.',
    );
    await this.ensureParticipantsAreNearby(
      driverLocation,
      riderLocation,
      this.tripStartProximityMeters,
      'Driver and rider must be at the same pickup point to start the trip.',
    );

    await this.tripTrackingService.recordLocation(
      ride.id,
      driverId,
      EClientType.DRIVER,
      driverLocation,
    );

    const transition = await this.ridesManagementService.transitionRideStatus(
      ride.id,
      [ERideStatus.ACCEPTED, ERideStatus.ASSIGNED, ERideStatus.ENROUTE],
      ERideStatus.TRIP_STARTED,
      'Driver started the trip',
    );

    const updated = transition.ride;
    const refreshed = await this.rideRepository.findById(updated.id);
    const current = refreshed ?? updated;

    if (transition.changed) {
      await this.notificationService.notifyRideStarted(current);
    }
    return current;
  }

  async recordTripLocation(
    rideId: string,
    requester: RequestingClient,
    location: ParticipantLocation,
  ): Promise<void> {
    const ride = await this.rideRepository.findById(rideId);
    if (!ride) {
      throw new NotFoundException('Ride not found');
    }

    this.ridesManagementService.ensureRequesterCanAccessRide(ride, requester);

    if (ride.status === ERideStatus.CANCELED) {
      throw new BadRequestException('Cancelled ride cannot be tracked');
    }

    if (ride.status === ERideStatus.COMPLETED) {
      throw new BadRequestException('Completed ride cannot be tracked');
    }

    if (!requester.role) {
      throw new BadRequestException('Client role required');
    }

    if (requester.role === EClientType.DRIVER) {
      const driverId = requester.id;
      if (!driverId || ride.driverId !== driverId) {
        throw new NotFoundException('Ride not found');
      }

      await this.tripTrackingService.recordLocation(
        ride.id,
        driverId,
        EClientType.DRIVER,
        location,
      );
      return;
    }

    if (requester.role === EClientType.RIDER) {
      await this.tripTrackingService.recordLocation(
        ride.id,
        ride.riderId,
        EClientType.RIDER,
        location,
      );
      return;
    }

    throw new BadRequestException('Unsupported client role for trip tracking');
  }

  async completeRide(
    id: string,
    requester: RequestingClient,
    input: { driverLocation: ParticipantLocation; discountAmount?: number },
  ): Promise<Ride> {
    const ride = await this.rideRepository.findById(id);
    if (!ride) {
      throw new NotFoundException('Ride not found');
    }
    if (ride.driverId !== requester.id) {
      throw new NotFoundException('Ride not found');
    }
    if (ride.status === ERideStatus.CANCELED) {
      throw new BadRequestException('Cancelled ride cannot be completed');
    }
    if (ride.status === ERideStatus.COMPLETED) {
      throw new BadRequestException('Ride already completed');
    }

    const riderLocation = await this.tripTrackingService.getLatestLocation(
      ride.id,
      EClientType.RIDER,
    );

    if (!riderLocation) {
      throw new BadRequestException(
        'Unable to complete ride without rider location confirmation.',
      );
    }

    const dropoffPoint = {
      longitude: ride.dropoffLongitude,
      latitude: ride.dropoffLatitude,
    };

    await this.ensureLocationWithinRadius(
      input.driverLocation,
      dropoffPoint,
      this.tripCompletionProximityMeters,
      'Driver must arrive at the destination to complete the ride.',
    );
    await this.ensureLocationWithinRadius(
      riderLocation,
      dropoffPoint,
      this.tripCompletionProximityMeters,
      'Rider location does not match destination.',
    );
    await this.ensureParticipantsAreNearby(
      input.driverLocation,
      riderLocation,
      this.tripCompletionProximityMeters,
      'Driver and rider must be at the destination together to complete the ride.',
    );

    if (ride.driverId) {
      await this.tripTrackingService.recordLocation(
        ride.id,
        ride.driverId,
        EClientType.DRIVER,
        input.driverLocation,
      );
    }

    const totalDistanceMeters =
      await this.tripTrackingService.getTotalDistanceMeters(ride.id);

    let distanceKm = totalDistanceMeters / 1000;
    if (!Number.isFinite(distanceKm) || distanceKm <= 0) {
      distanceKm = ride.distanceActualKm ?? ride.distanceEstimatedKm ?? 0;
    }

    const fare = this.fareEngine.calculateFare({
      distanceKm,
      discountAmount: input.discountAmount,
    });

    const { ride: updated } =
      await this.ridesManagementService.transitionRideStatus(
        ride.id,
        [
          ERideStatus.ENROUTE,
          ERideStatus.ACCEPTED,
          ERideStatus.ASSIGNED,
          ERideStatus.TRIP_STARTED,
        ],
        ERideStatus.COMPLETED,
        'Driver marked the ride as completed',
      );

    updated.distanceActualKm = fare.roundedDistanceKm;
    updated.discountPercent = fare.discountPercent;
    updated.discountAmount = fare.discountAmount.toFixed(2);
    updated.fareFinal = fare.finalFare.toFixed(2);
    updated.appFeeAmount = fare.appFeeAmount.toFixed(2);
    updated.paymentStatus = ERidePaymentStatus.PENDING;
    updated.paymentUrl = null;

    await this.tripTrackingService.markRideCompleted(ride.id);

    const saved = await this.rideRepository.updateRide(updated);
    const refreshed = (await this.rideRepository.findById(saved.id)) ?? saved;

    await this.notificationService.notifyRideCompleted(refreshed, {
      baseFare: fare.baseFare.toFixed(2),
      discountPercent: fare.discountPercent,
      discountAmount: fare.discountAmount.toFixed(2),
      finalFare: fare.finalFare.toFixed(2),
      appFee: fare.appFeeAmount.toFixed(2),
    });

    return refreshed;
  }

  private async ensureLocationWithinRadius(
    location: ParticipantLocation,
    target: { longitude: number; latitude: number },
    radiusMeters: number,
    errorMessage: string,
  ): Promise<void> {
    const distance = await this.calculateDistanceMeters(
      location.longitude,
      location.latitude,
      target.longitude,
      target.latitude,
    );

    if (distance > radiusMeters) {
      throw new BadRequestException(errorMessage);
    }
  }

  private async ensureParticipantsAreNearby(
    first: ParticipantLocation,
    second: ParticipantLocation,
    radiusMeters: number,
    errorMessage: string,
  ): Promise<void> {
    const distance = await this.calculateDistanceMeters(
      first.longitude,
      first.latitude,
      second.longitude,
      second.latitude,
    );
    if (distance > radiusMeters) {
      throw new BadRequestException(errorMessage);
    }
  }

  private async calculateDistanceMeters(
    lon1: number,
    lat1: number,
    lon2: number,
    lat2: number,
  ): Promise<number> {
    return this.tripTrackingService.calculateDistanceBetweenCoordinates(
      { longitude: lon1, latitude: lat1 },
      { longitude: lon2, latitude: lat2 },
    );
  }

  private getNumberConfig(key: string, defaultValue: number): number {
    const value = this.configService.get(key);

    if (typeof value === 'number') {
      return value;
    }

    if (typeof value === 'string') {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }

    return defaultValue;
  }
}
