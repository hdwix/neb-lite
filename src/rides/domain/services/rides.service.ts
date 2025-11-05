import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue, QueueEvents, JobsOptions } from 'bullmq';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { AxiosError } from 'axios';
import { lastValueFrom } from 'rxjs';
import {
  RIDE_QUEUE_NAME,
  RideCoordinate,
  RideQueueJob,
  RideQueueJobData,
  RideRouteEstimationJobData,
} from '../types/ride-queue.types';
import { RideRepository } from '../../infrastructure/repositories/ride.repository';
import { Ride } from '../entities/ride.entity';
import { ERideStatus } from '../../../app/enums/ride-status.enum';
import { RideStatusHistoryRepository } from '../../infrastructure/repositories/ride-status-history.repository';
import { EClientType } from '../../../app/enums/client-type.enum';
import { RideNotificationService } from './ride-notification.service';
import { LocationService } from '../../../location/domain/services/location.service';
import { RideDriverCandidateRepository } from '../../infrastructure/repositories/ride-driver-candidate.repository';
import { RideDriverCandidate } from '../entities/ride-driver-candidate.entity';
import { ERideDriverCandidateStatus } from '../constants/ride-driver-candidate-status.enum';
import { NearbyDriver } from '../../../location/domain/services/location.types';
import { TripTrackingService, ParticipantLocation } from './trip-tracking.service';
import { ERidePaymentStatus } from '../../../app/enums/ride-payment-status.enum';
interface RouteSummary {
  distanceMeters: number;
  durationSeconds: number;
}

export interface RouteEstimates {
  distanceKm: number;
  durationSeconds: number;
}

interface RequestingClient {
  id: string;
  role?: EClientType;
}

interface CreateRideInput {
  pickup: RideCoordinate;
  dropoff: RideCoordinate;
  note?: string;
  maxDrivers?: number;
}

interface CancelRideInput {
  reason?: string;
}

@Injectable()
export class RidesService {
  private readonly logger = new Logger(RidesService.name);
  private readonly fareRatePerKm = 3000;
  private readonly routeEstimationJobTimeoutMs = 30_000;
  private readonly defaultDriverCandidateLimit = 10;
  private readonly maxDriverCandidateLimit = 20;
  private readonly tripStartProximityMeters: number;
  private readonly tripCompletionProximityMeters: number;
  private readonly minDiscountPercent: number;
  private readonly maxDiscountPercent: number;
  private readonly appFeePercent: number;
  private readonly appFeeMinimumAmount: number;
  private readonly appFeeMinimumThreshold: number;
  private readonly paymentBaseUrl: string | null;

  constructor(
    @InjectQueue(RIDE_QUEUE_NAME)
    private readonly rideQueue: Queue<RideQueueJobData>,
    private readonly rideRepository: RideRepository,
    private readonly rideStatusHistoryRepository: RideStatusHistoryRepository,
    private readonly notificationService: RideNotificationService,
    private readonly candidateRepository: RideDriverCandidateRepository,
    private readonly locationService: LocationService,
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly tripTrackingService: TripTrackingService,
  ) {
    this.tripStartProximityMeters = this.getNumberConfig(
      'TRIP_START_PROXIMITY_METERS',
      50,
    );
    this.tripCompletionProximityMeters = this.getNumberConfig(
      'TRIP_COMPLETION_PROXIMITY_METERS',
      75,
    );
    this.minDiscountPercent = this.getNumberConfig(
      'TRIP_DISCOUNT_MIN_PERCENT',
      0,
    );
    this.maxDiscountPercent = this.getNumberConfig(
      'TRIP_DISCOUNT_MAX_PERCENT',
      50,
    );
    this.appFeePercent = this.getNumberConfig('APP_FEE_PERCENT', 5);
    this.appFeeMinimumAmount = this.getNumberConfig('APP_FEE_MIN_AMOUNT', 3000);
    this.appFeeMinimumThreshold = this.getNumberConfig(
      'APP_FEE_MIN_THRESHOLD',
      10_000,
    );
    const paymentUrl = this.configService.get<string>('PAYMENT_BASE_URL');
    this.paymentBaseUrl = paymentUrl ?? null;
  }

  async createRide(riderId: string, payload: CreateRideInput): Promise<Ride> {
    const ride = this.rideRepository.create({
      riderId,
      pickupLongitude: payload.pickup.longitude,
      pickupLatitude: payload.pickup.latitude,
      dropoffLongitude: payload.dropoff.longitude,
      dropoffLatitude: payload.dropoff.latitude,
      note: payload.note,
      status: ERideStatus.REQUESTED,
    });

    const savedRide = await this.rideRepository.save(ride);

    let routeEstimates: RouteEstimates | null = null;
    try {
      routeEstimates = await this.requestRouteEstimatesThroughQueue(
        savedRide.id,
        payload.pickup,
        payload.dropoff,
      );
    } catch (error) {
      await this.rollbackRideCreation(savedRide);
      throw error;
    }

    if (!routeEstimates) {
      throw new BadRequestException(
        'Unable to calculate route distance at this time. Please try again later.',
      );
    }

    savedRide.distanceEstimatedKm = routeEstimates.distanceKm;
    savedRide.durationEstimatedSeconds = routeEstimates.durationSeconds;
    savedRide.fareEstimated = this.calculateEstimatedFare(
      savedRide.distanceEstimatedKm,
    );

    const rideWithEstimates = await this.rideRepository.save(savedRide);
    await this.recordStatusChange(
      rideWithEstimates,
      null,
      ERideStatus.REQUESTED,
      {
        context: 'Ride requested by rider',
      },
    );

    const candidateLimit = this.resolveCandidateLimit(payload.maxDrivers);

    const nearbyDrivers = await this.locationService.getNearbyDrivers(
      payload.pickup.longitude,
      payload.pickup.latitude,
      candidateLimit,
    );

    const candidates = await this.createDriverCandidates(
      rideWithEstimates,
      nearbyDrivers,
    );

    if (candidates.length > 0) {
      rideWithEstimates.status = ERideStatus.CANDIDATES_COMPUTED;
      const updatedRide = await this.rideRepository.save(rideWithEstimates);
      await this.recordStatusChange(
        updatedRide,
        ERideStatus.REQUESTED,
        ERideStatus.CANDIDATES_COMPUTED,
        {
          context: `Invited ${candidates.length} drivers`,
        },
      );
      updatedRide.candidates = candidates;

      await Promise.all(
        candidates.map((candidate) =>
          this.notificationService.notifyRideOffered(
            updatedRide,
            candidate,
            routeEstimates!,
          ),
        ),
      );

      await this.notificationService.notifyRideMatched(updatedRide);

      return updatedRide;
    }

    rideWithEstimates.candidates = [];
    return rideWithEstimates;
  }

  async getRideById(id: string, requester: RequestingClient): Promise<Ride> {
    const ride = await this.rideRepository.findById(id);
    if (!ride) {
      throw new NotFoundException('Ride not found');
    }

    this.ensureRequesterCanAccessRide(ride, requester);
    return ride;
  }

  async cancelRide(
    id: string,
    requester: RequestingClient,
    payload: CancelRideInput = {},
  ): Promise<Ride> {
    const ride = await this.rideRepository.findById(id);
    if (!ride) {
      throw new NotFoundException('Ride not found');
    }
    if (ride.riderId !== requester.id) {
      throw new NotFoundException('Ride not found');
    }
    if (ride.status === ERideStatus.COMPLETED) {
      throw new BadRequestException('Completed ride cannot be cancelled');
    }
    if (ride.status === ERideStatus.CANCELED) {
      return ride;
    }

    await this.removePendingJobs(ride.id);

    const { ride: updated } = await this.transitionRideStatus(
      ride.id,
      [
        ERideStatus.REQUESTED,
        ERideStatus.CANDIDATES_COMPUTED,
        ERideStatus.ASSIGNED,
        ERideStatus.ACCEPTED,
        ERideStatus.ENROUTE,
      ],
      ERideStatus.CANCELED,
      payload.reason ?? 'Ride cancelled by rider',
    );

    if (payload.reason) {
      updated.cancelReason = payload.reason;
    }
    updated.fareFinal = '0.00';

    await this.rideRepository.save(updated);

    const candidates = await this.candidateRepository.findByRideId(updated.id);
    const now = new Date();
    const toUpdate: RideDriverCandidate[] = [];

    for (const candidate of candidates) {
      if (candidate.status === ERideDriverCandidateStatus.CANCELED) {
        continue;
      }
      candidate.status = ERideDriverCandidateStatus.CANCELED;
      candidate.reason = payload.reason ?? 'Ride cancelled by rider';
      candidate.respondedAt = now;
      toUpdate.push(candidate);
    }

    if (toUpdate.length > 0) {
      await this.candidateRepository.saveMany(toUpdate);
      await Promise.all(
        toUpdate.map((candidate) =>
          this.notificationService.notifyRideCanceledForCandidate(
            updated,
            candidate,
            payload.reason,
          ),
        ),
      );
    }

    const refreshed = await this.rideRepository.findById(updated.id);
    return refreshed ?? updated;
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
      return ride;
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
      'rider',
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
      'driver',
      driverLocation,
    );

    const transition = await this.transitionRideStatus(
      ride.id,
      [ERideStatus.ACCEPTED, ERideStatus.ASSIGNED],
      ERideStatus.ENROUTE,
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

    this.ensureRequesterCanAccessRide(ride, requester);

    if (ride.status === ERideStatus.CANCELED) {
      throw new BadRequestException('Cancelled ride cannot be tracked');
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
        'driver',
        location,
      );
      return;
    }

    if (requester.role === EClientType.RIDER) {
      await this.tripTrackingService.recordLocation(
        ride.id,
        ride.riderId,
        'rider',
        location,
      );
      return;
    }

    throw new BadRequestException('Unsupported client role for trip tracking');
  }

  async completeRide(
    id: string,
    requester: RequestingClient,
    driverLocation: ParticipantLocation,
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
      return ride;
    }

    const riderLocation = await this.tripTrackingService.getLatestLocation(
      ride.id,
      'rider',
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
      driverLocation,
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
      driverLocation,
      riderLocation,
      this.tripCompletionProximityMeters,
      'Driver and rider must be at the destination together to complete the ride.',
    );

    if (ride.driverId) {
      await this.tripTrackingService.recordLocation(
        ride.id,
        ride.driverId,
        'driver',
        driverLocation,
      );
    }

    const totalDistanceMeters =
      await this.tripTrackingService.getTotalDistanceMeters(ride.id);

    let distanceKm = totalDistanceMeters / 1000;
    if (!Number.isFinite(distanceKm) || distanceKm <= 0) {
      distanceKm = ride.distanceActualKm ?? ride.distanceEstimatedKm ?? 0;
    }

    const roundedDistanceKm = this.roundDistanceKm(distanceKm);

    const baseFare = Math.max(0, roundedDistanceKm * this.fareRatePerKm);
    const discountPercent = this.resolveDiscountPercent(ride.discountPercent);
    const discountAmount = this.calculateMonetaryAmount(
      baseFare * (discountPercent / 100),
    );
    const fareAfterDiscount = this.calculateMonetaryAmount(
      baseFare - discountAmount,
    );
    const appFeeAmount = this.calculateAppFee(fareAfterDiscount);

    const { ride: updated } = await this.transitionRideStatus(
      ride.id,
      [ERideStatus.ENROUTE, ERideStatus.ACCEPTED, ERideStatus.ASSIGNED],
      ERideStatus.COMPLETED,
      'Driver marked the ride as completed',
    );

    updated.distanceActualKm = roundedDistanceKm;
    updated.discountPercent = discountPercent;
    updated.discountAmount = discountAmount.toFixed(2);
    updated.fareFinal = fareAfterDiscount.toFixed(2);
    updated.appFeeAmount = appFeeAmount.toFixed(2);
    updated.paymentStatus = ERidePaymentStatus.PENDING;
    updated.paymentUrl = this.buildPaymentUrl(updated, fareAfterDiscount);

    await this.tripTrackingService.markRideCompleted(ride.id);

    const saved = await this.rideRepository.save(updated);
    const refreshed = (await this.rideRepository.findById(saved.id)) ?? saved;

    await this.notificationService.notifyRideCompleted(refreshed, {
      baseFare: baseFare.toFixed(2),
      discountPercent,
      discountAmount: discountAmount.toFixed(2),
      finalFare: fareAfterDiscount.toFixed(2),
      appFee: appFeeAmount.toFixed(2),
    });

    return refreshed;
  }

  async applyRideDiscount(
    rideId: string,
    driverId: string,
    payload: { discountPercent: number },
  ): Promise<Ride> {
    const ride = await this.rideRepository.findById(rideId);
    if (!ride) {
      throw new NotFoundException('Ride not found');
    }

    if (ride.driverId !== driverId) {
      throw new NotFoundException('Ride not found');
    }

    if (ride.status === ERideStatus.CANCELED) {
      throw new BadRequestException('Cancelled ride cannot be discounted');
    }

    if (ride.status === ERideStatus.COMPLETED) {
      throw new BadRequestException('Completed ride cannot be discounted');
    }

    const normalized = this.resolveDiscountPercent(payload.discountPercent);

    ride.discountPercent = normalized;
    ride.discountAmount = null;

    const saved = await this.rideRepository.save(ride);
    const refreshed = await this.rideRepository.findById(saved.id);
    return refreshed ?? saved;
  }

  async confirmRidePayment(
    rideId: string,
    riderId: string,
    payload: { paymentReference?: string },
  ): Promise<Ride> {
    const ride = await this.rideRepository.findById(rideId);
    if (!ride) {
      throw new NotFoundException('Ride not found');
    }

    if (ride.riderId !== riderId) {
      throw new NotFoundException('Ride not found');
    }

    if (ride.status !== ERideStatus.COMPLETED) {
      throw new BadRequestException('Ride must be completed before payment');
    }

    if (ride.paymentStatus === ERidePaymentStatus.PAID) {
      return ride;
    }

    ride.paymentStatus = ERidePaymentStatus.PAID;

    const saved = await this.rideRepository.save(ride);
    const refreshed = (await this.rideRepository.findById(saved.id)) ?? saved;

    await this.notificationService.notifyRidePaid(refreshed, payload.paymentReference);

    return refreshed;
  }

  async acceptRideByDriver(rideId: string, driverId: string): Promise<Ride> {
    let ride = await this.rideRepository.findById(rideId);
    if (!ride) {
      throw new NotFoundException('Ride not found');
    }

    if (ride.status === ERideStatus.CANCELED) {
      throw new BadRequestException('Cancelled ride cannot be accepted');
    }
    if (ride.status === ERideStatus.COMPLETED) {
      throw new BadRequestException('Completed ride cannot be accepted');
    }

    const candidate = await this.candidateRepository.findByRideAndDriver(
      rideId,
      driverId,
    );

    if (!candidate) {
      throw new NotFoundException('Ride not available for this driver');
    }

    if (candidate.status === ERideDriverCandidateStatus.CANCELED) {
      throw new ConflictException('Ride invitation is no longer active');
    }

    if (candidate.status === ERideDriverCandidateStatus.DECLINED) {
      throw new BadRequestException('Ride already declined by driver');
    }

    if (
      candidate.status === ERideDriverCandidateStatus.CONFIRMED ||
      (candidate.status === ERideDriverCandidateStatus.ACCEPTED &&
        ride.driverId === driverId &&
        (ride.status === ERideStatus.ACCEPTED ||
          ride.status === ERideStatus.ENROUTE))
    ) {
      return ride;
    }

    const now = new Date();
    const markCandidateSuperseded = async (currentRide: Ride) => {
      candidate.status = ERideDriverCandidateStatus.CANCELED;
      candidate.reason = 'Another driver already accepted this ride';
      candidate.respondedAt = now;
      await this.candidateRepository.save(candidate);
      await this.notificationService.notifyCandidateSuperseded(
        currentRide,
        candidate,
      );
    };

    if (ride.driverId && ride.driverId !== driverId) {
      await markCandidateSuperseded(ride);
      throw new ConflictException('Ride already accepted by another driver');
    }

    if (!ride.driverId) {
      const claimed = await this.rideRepository.claimDriver(ride.id, driverId);

      if (!claimed) {
        ride = (await this.rideRepository.findById(ride.id)) ?? ride;

        if (ride.driverId && ride.driverId !== driverId) {
          await markCandidateSuperseded(ride);
          throw new ConflictException(
            'Ride already accepted by another driver',
          );
        }
      } else {
        ride.driverId = driverId;
      }
    }

    candidate.status = ERideDriverCandidateStatus.ACCEPTED;
    candidate.reason = null;
    candidate.respondedAt = now;
    await this.candidateRepository.save(candidate);

    const assignment = await this.transitionRideStatus(
      ride.id,
      [ERideStatus.REQUESTED, ERideStatus.CANDIDATES_COMPUTED],
      ERideStatus.ASSIGNED,
      'Driver responded to invitation',
    );

    ride = assignment.ride;

    const acceptance = await this.transitionRideStatus(
      ride.id,
      [ERideStatus.ASSIGNED, ERideStatus.CANDIDATES_COMPUTED],
      ERideStatus.ACCEPTED,
      'Driver accepted ride request',
    );

    await this.notificationService.notifyDriverAccepted(
      acceptance.ride,
      candidate,
    );

    const refreshed = await this.rideRepository.findById(ride.id);
    return refreshed ?? acceptance.ride;
  }

  async rejectRideByDriver(
    rideId: string,
    driverId: string,
    reason?: string,
  ): Promise<Ride> {
    let ride = await this.rideRepository.findById(rideId);
    if (!ride) {
      throw new NotFoundException('Ride not found');
    }

    if (ride.status === ERideStatus.CANCELED) {
      return ride;
    }

    if (ride.status === ERideStatus.COMPLETED) {
      throw new BadRequestException('Completed ride cannot be declined');
    }

    if (ride.status === ERideStatus.ENROUTE) {
      throw new BadRequestException('Ride already in progress');
    }

    const candidate = await this.candidateRepository.findByRideAndDriver(
      rideId,
      driverId,
    );

    if (!candidate) {
      throw new NotFoundException('Ride not available for this driver');
    }

    if (candidate.status === ERideDriverCandidateStatus.DECLINED) {
      return ride;
    }

    if (candidate.status === ERideDriverCandidateStatus.CANCELED) {
      return ride;
    }

    const rejectionReason = reason ?? 'Driver declined the ride invitation';
    candidate.status = ERideDriverCandidateStatus.DECLINED;
    candidate.reason = rejectionReason;
    candidate.respondedAt = new Date();
    await this.candidateRepository.save(candidate);

    if (ride.driverId === driverId) {
      ride.driverId = null;
      ride = await this.rideRepository.save(ride);
      const reverted = await this.transitionRideStatus(
        ride.id,
        [ERideStatus.ACCEPTED, ERideStatus.ASSIGNED],
        ERideStatus.CANDIDATES_COMPUTED,
        rejectionReason,
      );
      ride = reverted.ride;
    }

    await this.notificationService.notifyDriverDeclined(ride, candidate);

    const refreshed = await this.rideRepository.findById(ride.id);
    return refreshed ?? ride;
  }

  async confirmDriverAcceptance(
    rideId: string,
    riderId: string,
  ): Promise<Ride> {
    const ride = await this.rideRepository.findById(rideId);
    if (!ride) {
      throw new NotFoundException('Ride not found');
    }
    if (ride.riderId !== riderId) {
      throw new NotFoundException('Ride not found');
    }
    const driverId = ride.driverId;

    if (!driverId) {
      throw new BadRequestException('Ride does not have an assigned driver');
    }
    if (ride.status === ERideStatus.CANCELED) {
      throw new BadRequestException('Cancelled ride cannot be confirmed');
    }
    if (ride.status === ERideStatus.COMPLETED) {
      return ride;
    }
    if (
      ride.status === ERideStatus.ASSIGNED ||
      ride.status === ERideStatus.REQUESTED
    ) {
      throw new BadRequestException('Driver has not accepted this ride yet');
    }
    if (ride.status === ERideStatus.ENROUTE) {
      return ride;
    }

    const candidate = await this.candidateRepository.findByRideAndDriver(
      rideId,
      driverId,
    );

    if (!candidate) {
      throw new ConflictException('Selected driver is no longer available');
    }

    if (candidate.status !== ERideDriverCandidateStatus.ACCEPTED) {
      throw new BadRequestException('Driver has not confirmed availability');
    }

    const confirmation = await this.transitionRideStatus(
      ride.id,
      [ERideStatus.ACCEPTED],
      ERideStatus.ENROUTE,
      'Rider accepted driver confirmation',
    );

    const updatedRide = confirmation.ride;

    const candidates = await this.candidateRepository.findByRideId(rideId);
    const now = new Date();
    const toUpdate: RideDriverCandidate[] = [];
    const superseded: RideDriverCandidate[] = [];

    for (const entry of candidates) {
      if (entry.driverId === driverId) {
        entry.status = ERideDriverCandidateStatus.CONFIRMED;
        entry.respondedAt = now;
        entry.reason = null;
        toUpdate.push(entry);
      } else if (
        entry.status === ERideDriverCandidateStatus.INVITED ||
        entry.status === ERideDriverCandidateStatus.ACCEPTED
      ) {
        entry.status = ERideDriverCandidateStatus.CANCELED;
        entry.respondedAt = now;
        entry.reason = 'Ride confirmed with another driver';
        toUpdate.push(entry);
        superseded.push(entry);
      }
    }

    if (toUpdate.length > 0) {
      await this.candidateRepository.saveMany(toUpdate);
    }

    await this.notificationService.notifyRiderConfirmed(updatedRide, candidate);
    await Promise.all(
      superseded.map((entry) =>
        this.notificationService.notifyCandidateSuperseded(updatedRide, entry),
      ),
    );

    const refreshed = await this.rideRepository.findById(updatedRide.id);
    return refreshed ?? updatedRide;
  }

  async rejectDriverAcceptance(
    rideId: string,
    riderId: string,
    reason?: string,
  ): Promise<Ride> {
    const ride = await this.rideRepository.findById(rideId);
    if (!ride) {
      throw new NotFoundException('Ride not found');
    }
    if (ride.riderId !== riderId) {
      throw new NotFoundException('Ride not found');
    }
    const driverId = ride.driverId;

    if (!driverId) {
      throw new BadRequestException('Ride does not have an assigned driver');
    }
    if (ride.status === ERideStatus.CANCELED) {
      return ride;
    }
    if (ride.status === ERideStatus.COMPLETED) {
      throw new BadRequestException('Completed ride cannot be rejected');
    }
    if (ride.status === ERideStatus.ENROUTE) {
      throw new BadRequestException('Ride already in progress');
    }
    if (
      ride.status === ERideStatus.ASSIGNED ||
      ride.status === ERideStatus.REQUESTED
    ) {
      throw new BadRequestException('Driver has not accepted this ride yet');
    }
    const candidate = await this.candidateRepository.findByRideAndDriver(
      rideId,
      driverId,
    );

    if (!candidate) {
      throw new ConflictException('Driver invitation is no longer active');
    }

    const rejectionReason = reason ?? 'Rider rejected the driver acceptance';
    const now = new Date();
    candidate.status = ERideDriverCandidateStatus.CANCELED;
    candidate.reason = rejectionReason;
    candidate.respondedAt = now;
    await this.candidateRepository.save(candidate);

    ride.driverId = null;
    await this.rideRepository.save(ride);

    const reverted = await this.transitionRideStatus(
      ride.id,
      [ERideStatus.ACCEPTED, ERideStatus.ASSIGNED],
      ERideStatus.CANDIDATES_COMPUTED,
      rejectionReason,
    );

    await this.notificationService.notifyRiderRejectedDriver(
      reverted.ride,
      candidate,
      reason,
    );

    const refreshed = await this.rideRepository.findById(reverted.ride.id);
    return refreshed ?? reverted.ride;
  }

  async notifyRideMatched(ride: Ride): Promise<void> {
    await this.notificationService.notifyRideMatched(ride);
  }

  async transitionRideStatus(
    rideId: string,
    allowedStatuses: ERideStatus[],
    nextStatus: ERideStatus,
    context?: string,
  ): Promise<{ ride: Ride; changed: boolean }> {
    const ride = await this.rideRepository.findById(rideId);
    if (!ride) {
      throw new NotFoundException('Ride not found');
    }

    if (!allowedStatuses.includes(ride.status)) {
      this.logger.debug(
        `Skipping status change for ride ${rideId} from ${ride.status} to ${nextStatus}`,
      );
      return { ride, changed: false };
    }

    if (ride.status === nextStatus) {
      this.logger.debug(
        `Ride ${rideId} already in status ${nextStatus}, skipping transition`,
      );
      return { ride, changed: false };
    }

    const previousStatus = ride.status;
    ride.status = nextStatus;
    if (context && nextStatus === ERideStatus.CANCELED) {
      ride.cancelReason = context;
    }
    const savedRide = await this.rideRepository.save(ride);
    await this.recordStatusChange(savedRide, previousStatus, nextStatus, {
      context,
    });
    return { ride: savedRide, changed: true };
  }

  private async createDriverCandidates(
    ride: Ride,
    nearbyDrivers: NearbyDriver[],
  ): Promise<RideDriverCandidate[]> {
    if (nearbyDrivers.length === 0) {
      return [];
    }

    const seen = new Set<string>();
    const candidates: RideDriverCandidate[] = [];

    for (const driver of nearbyDrivers) {
      if (!driver.driverId || seen.has(driver.driverId)) {
        continue;
      }
      seen.add(driver.driverId);
      const candidate = this.candidateRepository.create({
        rideId: ride.id,
        driverId: driver.driverId,
        status: ERideDriverCandidateStatus.INVITED,
        distanceMeters:
          driver.distanceMeters !== undefined && driver.distanceMeters !== null
            ? Math.round(driver.distanceMeters)
            : null,
      });
      candidates.push(candidate);
    }

    if (candidates.length === 0) {
      return [];
    }

    return this.candidateRepository.saveMany(candidates);
  }

  private resolveCandidateLimit(requested?: number): number {
    if (requested === undefined || requested === null) {
      return this.defaultDriverCandidateLimit;
    }

    const parsed = Math.floor(requested);

    if (!Number.isFinite(parsed) || parsed <= 0) {
      return this.defaultDriverCandidateLimit;
    }

    return Math.min(parsed, this.maxDriverCandidateLimit);
  }

  private ensureRequesterCanAccessRide(
    ride: Ride,
    requester: RequestingClient,
  ): void {
    if (!requester.role) {
      return;
    }

    if (requester.role === EClientType.RIDER && ride.riderId !== requester.id) {
      throw new NotFoundException('Ride not found');
    }

    if (
      requester.role === EClientType.DRIVER &&
      ride.driverId !== requester.id
    ) {
      throw new NotFoundException('Ride not found');
    }
  }

  private async recordStatusChange(
    ride: Ride,
    fromStatus: ERideStatus | null,
    toStatus: ERideStatus,
    options?: { context?: string },
  ): Promise<void> {
    const history = this.rideStatusHistoryRepository.create({
      rideId: ride.id,
      fromStatus: fromStatus ?? null,
      toStatus,
      context: options?.context,
    });
    await this.rideStatusHistoryRepository.save(history);
  }

  private async requestRouteEstimatesThroughQueue(
    rideId: string,
    pickup: RideCoordinate,
    dropoff: RideCoordinate,
  ): Promise<RouteEstimates> {
    const jobId = this.buildRouteEstimationJobId(rideId);

    await this.rideQueue.remove(jobId).catch(() => undefined);

    const queueEvents = await this.createQueueEvents();

    try {
      const jobOptions: JobsOptions & { timeout?: number } = {
        jobId,
        removeOnComplete: true,
        removeOnFail: 25,
        timeout: this.routeEstimationJobTimeoutMs,
      };

      const job = await this.rideQueue.add(
        RideQueueJob.EstimateRoute,
        {
          rideId,
          pickup,
          dropoff,
        },
        jobOptions,
      );

      try {
        const result = (await job.waitUntilFinished(
          queueEvents,
          this.routeEstimationJobTimeoutMs,
        )) as RouteEstimates;
        return result;
      } catch (error) {
        this.logRouteEstimationJobError(error, rideId);
        throw new BadRequestException(
          'Unable to calculate route distance at this time. Please try again later.',
        );
      }
    } finally {
      await queueEvents
        .close()
        .catch((error) =>
          this.logger.error(
            `Failed to close queue events for ride ${rideId}: ${error}`,
          ),
        );
    }
  }

  async fetchRouteEstimates(
    pickup: RideCoordinate,
    dropoff: RideCoordinate,
  ): Promise<RouteEstimates> {
    const summary = await this.requestRouteSummary(pickup, dropoff);

    return {
      distanceKm: this.roundDistanceKm(summary.distanceMeters / 1000),
      durationSeconds: Math.round(summary.durationSeconds),
    };
  }

  private async requestRouteSummary(
    pickup: RideCoordinate,
    dropoff: RideCoordinate,
  ): Promise<RouteSummary> {
    const skipOrsCall = this.getBooleanConfig('SKIP_ORS_CALL');
    const baseUrlKey = skipOrsCall ? 'MOCK_ORS_URL' : 'ORS_URL';
    const baseUrl = this.configService.get<string>(baseUrlKey);

    if (!baseUrl) {
      throw new Error(`Missing configuration for ${baseUrlKey}`);
    }

    const apiKey = this.configService.get<string>('ORS_APIKEY');
    const requestUrl = new URL(baseUrl);

    requestUrl.searchParams.set(
      'start',
      `${pickup.longitude},${pickup.latitude}`,
    );
    requestUrl.searchParams.set(
      'end',
      `${dropoff.longitude},${dropoff.latitude}`,
    );

    if (apiKey) {
      requestUrl.searchParams.set('api_key', apiKey);
    }

    const headers: Record<string, string> = {};
    if (apiKey) {
      headers.Authorization = apiKey;
    }
    if (skipOrsCall) {
      headers.xmock = 'true';
    }

    try {
      const response = await lastValueFrom(
        this.httpService.get(requestUrl.toString(), {
          headers: Object.keys(headers).length ? headers : undefined,
        }),
      );
      console.log(' ==== baseUrl =====');
      console.log(baseUrl);
      console.log(' ==== headers =====');
      console.log(headers);
      console.log('==== response ors====');
      console.log(response.data);

      return this.parseRouteSummary(response.data);
    } catch (error) {
      this.handleRouteEstimationError(error);
    }
  }

  private parseRouteSummary(payload: unknown): RouteSummary {
    if (!payload || typeof payload !== 'object') {
      throw new Error('OpenRouteService response is empty or invalid');
    }

    const features = (payload as { features?: unknown[] }).features;
    if (!Array.isArray(features) || features.length === 0) {
      throw new Error('OpenRouteService response does not contain features');
    }

    const firstFeature = features[0];
    const summary =
      (firstFeature as { properties?: { summary?: unknown } })?.properties
        ?.summary ?? null;

    if (!summary || typeof summary !== 'object') {
      throw new Error('OpenRouteService response summary is missing');
    }

    const distanceRaw = (summary as { distance?: unknown }).distance;
    const durationRaw = (summary as { duration?: unknown }).duration;

    const distanceMeters = Number(distanceRaw);
    const durationSeconds = Number(durationRaw);

    if (!Number.isFinite(distanceMeters) || !Number.isFinite(durationSeconds)) {
      throw new Error(
        'OpenRouteService response summary is missing distance or duration',
      );
    }

    return {
      distanceMeters,
      durationSeconds,
    };
  }

  private handleRouteEstimationError(error: unknown): never {
    if (error instanceof BadRequestException) {
      throw error;
    }

    if (this.isAxiosError(error)) {
      const status = error.response?.status;
      const statusText = error.response?.statusText;
      this.logger.error(
        `Failed to fetch route summary from OpenRouteService: ${status ?? 'unknown status'} ${statusText ?? ''} ${error.message}`,
      );
    } else if (error instanceof Error) {
      this.logger.error(
        `Failed to parse OpenRouteService response: ${error.message}`,
      );
    } else {
      this.logger.error(
        'Unknown error occurred while estimating route via OpenRouteService',
      );
    }

    throw new BadRequestException(
      'Unable to calculate route distance at this time. Please try again later.',
    );
  }

  private isAxiosError(error: unknown): error is AxiosError {
    return !!error && typeof error === 'object' && 'isAxiosError' in error;
  }

  private async createQueueEvents(): Promise<QueueEvents> {
    const queueEvents = new QueueEvents(this.rideQueue.name, {
      connection: this.rideQueue.opts.connection,
    });

    try {
      await queueEvents.waitUntilReady();
      return queueEvents;
    } catch (error) {
      await queueEvents.close().catch(() => undefined);
      throw error;
    }
  }

  private async rollbackRideCreation(ride: Ride): Promise<void> {
    try {
      await this.rideRepository.remove(ride);
    } catch (error) {
      this.logger.error(
        `Failed to rollback ride ${ride.id} after route estimation failure: ${error}`,
      );
    }

    await this.rideQueue
      .remove(this.buildRouteEstimationJobId(ride.id))
      .catch(() => undefined);
  }

  private logRouteEstimationJobError(error: unknown, rideId: string): void {
    if (!error) {
      this.logger.error(
        `Route estimation job for ride ${rideId} failed with an unknown error`,
      );
      return;
    }

    if (typeof error === 'object') {
      const failedReason = (error as { failedReason?: unknown }).failedReason;
      if (failedReason instanceof Error) {
        this.logger.error(
          `Route estimation job for ride ${rideId} failed: ${failedReason.message}`,
        );
        return;
      }
      if (typeof failedReason === 'string') {
        this.logger.error(
          `Route estimation job for ride ${rideId} failed: ${failedReason}`,
        );
        return;
      }
    }

    if (error instanceof Error) {
      this.logger.error(
        `Route estimation job for ride ${rideId} failed: ${error.message}`,
      );
      return;
    }

    this.logger.error(
      `Route estimation job for ride ${rideId} failed with unexpected error: ${String(
        error,
      )}`,
    );
  }

  private getBooleanConfig(key: string): boolean {
    const value = this.configService.get(key);

    if (typeof value === 'boolean') {
      return value;
    }

    if (typeof value === 'number') {
      return value === 1;
    }

    if (typeof value === 'string') {
      return ['true', '1', 'yes', 'y'].includes(value.toLowerCase());
    }

    return false;
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

  private resolveDiscountPercent(value?: number | null): number {
    if (value === undefined || value === null || Number.isNaN(value)) {
      return this.minDiscountPercent;
    }

    const bounded = Math.min(
      Math.max(value, this.minDiscountPercent),
      this.maxDiscountPercent,
    );

    return Number.isFinite(bounded) ? bounded : this.minDiscountPercent;
  }

  private calculateMonetaryAmount(value: number): number {
    if (!Number.isFinite(value) || value <= 0) {
      return 0;
    }
    return Math.round(value * 100) / 100;
  }

  private calculateAppFee(fareAfterDiscount: number): number {
    if (!Number.isFinite(fareAfterDiscount) || fareAfterDiscount <= 0) {
      return this.appFeeMinimumAmount;
    }

    if (fareAfterDiscount < this.appFeeMinimumThreshold) {
      return this.appFeeMinimumAmount;
    }

    return this.calculateMonetaryAmount(
      (fareAfterDiscount * this.appFeePercent) / 100,
    );
  }

  private buildPaymentUrl(ride: Ride, fare: number): string | null {
    if (!this.paymentBaseUrl) {
      return null;
    }

    try {
      const url = new URL(this.paymentBaseUrl);
      url.searchParams.set('rideId', ride.id);
      if (ride.driverId) {
        url.searchParams.set('driverId', ride.driverId);
      }
      url.searchParams.set('riderId', ride.riderId);
      url.searchParams.set('amount', (Math.round(fare * 100) / 100).toFixed(2));
      return url.toString();
    } catch (error) {
      this.logger.warn(
        `Failed to build payment URL for ride ${ride.id}: ${error}`,
      );
      return null;
    }
  }

  private calculateEstimatedFare(distanceKm?: number | null): string | null {
    if (
      distanceKm === undefined ||
      distanceKm === null ||
      Number.isNaN(distanceKm)
    ) {
      return null;
    }
    const fare = distanceKm * this.fareRatePerKm;
    return fare.toFixed(2);
  }

  private roundDistanceKm(distanceKm: number): number {
    return Number(distanceKm.toFixed(3));
  }

  private buildRouteEstimationJobId(rideId: string): string {
    return `ride-${rideId}-route-estimation`;
  }

  private async removePendingJobs(rideId: string): Promise<void> {
    try {
      await this.rideQueue.remove(this.buildRouteEstimationJobId(rideId));
    } catch (error) {
      this.logger.warn(
        `Failed to remove queue job for ride ${rideId}: ${error}`,
      );
    }
  }
}
