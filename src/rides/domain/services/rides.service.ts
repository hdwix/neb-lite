import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { RIDE_QUEUE_NAME, RideQueueJob, RideQueueJobData } from '../types/ride-queue.types';
import { RideRepository } from '../../infrastructure/repositories/ride.repository';
import { Ride } from '../entities/ride.entity';
import { ERideStatus } from '../../../app/enums/ride-status.enum';
import { RideStatusHistoryRepository } from '../../infrastructure/repositories/ride-status-history.repository';
import { EClientType } from '../../../app/enums/client-type.enum';

interface RequestingClient {
  id: string;
  role?: EClientType;
}

interface RideCoordinateInput {
  lon: number;
  lat: number;
}

interface CreateRideInput {
  pickup: RideCoordinateInput;
  dropoff: RideCoordinateInput;
  note?: string;
  driverId: string;
}

interface CancelRideInput {
  reason?: string;
}

@Injectable()
export class RidesService {
  private readonly logger = new Logger(RidesService.name);
  private readonly fareRatePerKm = 3000;

  constructor(
    @InjectQueue(RIDE_QUEUE_NAME)
    private readonly rideQueue: Queue<RideQueueJobData>,
    private readonly rideRepository: RideRepository,
    private readonly rideStatusHistoryRepository: RideStatusHistoryRepository,
  ) {}

  async createRide(riderId: string, payload: CreateRideInput): Promise<Ride> {
    if (!payload.driverId) {
      throw new BadRequestException('driverId is required for ride creation');
    }

    const ride = this.rideRepository.create({
      riderId,
      driverId: payload.driverId,
      pickupLon: payload.pickup.lon,
      pickupLat: payload.pickup.lat,
      dropoffLon: payload.dropoff.lon,
      dropoffLat: payload.dropoff.lat,
      note: payload.note,
      status: ERideStatus.REQUESTED,
    });

    ride.distanceEstimatedKm = this.calculateDistanceKm(
      payload.pickup,
      payload.dropoff,
    );
    ride.fareEstimated = this.calculateEstimatedFare(ride.distanceEstimatedKm);

    const savedRide = await this.rideRepository.save(ride);
    await this.recordStatusChange(savedRide, null, ERideStatus.REQUESTED, {
      context: 'Ride requested by rider',
    });

    await this.enqueueRideProcessing(savedRide);

    return savedRide;
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

    const updated = await this.transitionRideStatus(
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

    return this.rideRepository.save(updated);
  }

  async completeRide(id: string, requester: RequestingClient): Promise<Ride> {
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

    const updated = await this.transitionRideStatus(
      ride.id,
      [ERideStatus.ENROUTE, ERideStatus.ACCEPTED, ERideStatus.ASSIGNED],
      ERideStatus.COMPLETED,
      'Driver marked the ride as completed',
    );

    updated.fareFinal = updated.fareFinal ?? updated.fareEstimated;

    return this.rideRepository.save(updated);
  }

  async transitionRideStatus(
    rideId: string,
    allowedStatuses: ERideStatus[],
    nextStatus: ERideStatus,
    context?: string,
  ): Promise<Ride> {
    const ride = await this.rideRepository.findById(rideId);
    if (!ride) {
      throw new NotFoundException('Ride not found');
    }

    if (!allowedStatuses.includes(ride.status)) {
      this.logger.debug(
        `Skipping status change for ride ${rideId} from ${ride.status} to ${nextStatus}`,
      );
      return ride;
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
    return savedRide;
  }

  private async enqueueRideProcessing(ride: Ride): Promise<void> {
    if (!ride.driverId) {
      this.logger.warn(
        `Ride ${ride.id} missing driverId, skipping workflow enqueue`,
      );
      return;
    }

    await this.rideQueue.add(
      RideQueueJob.ProcessSelection,
      {
        rideId: ride.id,
        driverId: ride.driverId,
      },
      {
        jobId: this.buildQueueJobId(ride.id),
        removeOnComplete: true,
        removeOnFail: 25,
      },
    );
  }

  private ensureRequesterCanAccessRide(
    ride: Ride,
    requester: RequestingClient,
  ): void {
    if (!requester.role) {
      return;
    }

    if (
      requester.role === EClientType.RIDER &&
      ride.riderId !== requester.id
    ) {
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

  private calculateDistanceKm(
    pickup: RideCoordinateInput,
    dropoff: RideCoordinateInput,
  ): number {
    const earthRadiusKm = 6371;
    const dLat = this.toRad(dropoff.lat - pickup.lat);
    const dLon = this.toRad(dropoff.lon - pickup.lon);

    const lat1 = this.toRad(pickup.lat);
    const lat2 = this.toRad(dropoff.lat);

    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.sin(dLon / 2) * Math.sin(dLon / 2) *
        Math.cos(lat1) *
        Math.cos(lat2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return Number((earthRadiusKm * c).toFixed(3));
  }

  private calculateEstimatedFare(distanceKm?: number | null): string | null {
    if (distanceKm === undefined || distanceKm === null || Number.isNaN(distanceKm)) {
      return null;
    }
    const fare = distanceKm * this.fareRatePerKm;
    return fare.toFixed(2);
  }

  private toRad(degree: number): number {
    return (degree * Math.PI) / 180;
  }

  private buildQueueJobId(rideId: string): string {
    return `ride-${rideId}`;
  }

  private async removePendingJobs(rideId: string): Promise<void> {
    try {
      await this.rideQueue.removeJobs(this.buildQueueJobId(rideId));
    } catch (error) {
      this.logger.warn(`Failed to remove queue job for ride ${rideId}: ${error}`);
    }
  }
}
