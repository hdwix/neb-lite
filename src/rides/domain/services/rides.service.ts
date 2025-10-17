import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { AxiosError } from 'axios';
import { lastValueFrom } from 'rxjs';
import { RIDE_QUEUE_NAME, RideQueueJob, RideQueueJobData } from '../types/ride-queue.types';
import { RideRepository } from '../../infrastructure/repositories/ride.repository';
import { Ride } from '../entities/ride.entity';
import { ERideStatus } from '../../../app/enums/ride-status.enum';
import { RideStatusHistoryRepository } from '../../infrastructure/repositories/ride-status-history.repository';
import { EClientType } from '../../../app/enums/client-type.enum';
interface RouteSummary {
  distanceMeters: number;
  durationSeconds: number;
}

interface RouteEstimates {
  distanceKm: number;
  durationSeconds: number;
}

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
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
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

    const routeEstimates = await this.fetchRouteEstimates(
      payload.pickup,
      payload.dropoff,
    );

    ride.distanceEstimatedKm = routeEstimates.distanceKm;
    ride.durationEstimatedSeconds = routeEstimates.durationSeconds;
    ride.fareEstimated = this.calculateEstimatedFare(ride.distanceEstimatedKm);

    const savedRide = await this.rideRepository.save(ride);
    savedRide.durationEstimatedSeconds = routeEstimates.durationSeconds;
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

  private async fetchRouteEstimates(
    pickup: RideCoordinateInput,
    dropoff: RideCoordinateInput,
  ): Promise<RouteEstimates> {
    const summary = await this.requestRouteSummary(pickup, dropoff);

    return {
      distanceKm: this.roundDistanceKm(summary.distanceMeters / 1000),
      durationSeconds: Math.round(summary.durationSeconds),
    };
  }

  private async requestRouteSummary(
    pickup: RideCoordinateInput,
    dropoff: RideCoordinateInput,
  ): Promise<RouteSummary> {
    if (!this.areValidCoordinates(pickup) || !this.areValidCoordinates(dropoff)) {
      throw new BadRequestException('Invalid coordinates provided for route estimation');
    }

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
      `${pickup.lon},${pickup.lat}`,
    );
    requestUrl.searchParams.set(
      'end',
      `${dropoff.lon},${dropoff.lat}`,
    );

    if (apiKey) {
      requestUrl.searchParams.set('api_key', apiKey);
    }

    const headers: Record<string, string> = {};
    if (apiKey) {
      headers.Authorization = apiKey;
    }

    try {
      const response = await lastValueFrom(
        this.httpService.get(requestUrl.toString(), {
          headers: Object.keys(headers).length ? headers : undefined,
        }),
      );

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
      throw new Error('OpenRouteService response summary is missing distance or duration');
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
      this.logger.error(`Failed to parse OpenRouteService response: ${error.message}`);
    } else {
      this.logger.error('Unknown error occurred while estimating route via OpenRouteService');
    }

    throw new BadRequestException(
      'Unable to calculate route distance at this time. Please try again later.',
    );
  }

  private isAxiosError(error: unknown): error is AxiosError {
    return !!error && typeof error === 'object' && 'isAxiosError' in error;
  }

  private areValidCoordinates(coordinates: RideCoordinateInput): boolean {
    return (
      Number.isFinite(coordinates.lon) && Number.isFinite(coordinates.lat)
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

  private calculateEstimatedFare(distanceKm?: number | null): string | null {
    if (distanceKm === undefined || distanceKm === null || Number.isNaN(distanceKm)) {
      return null;
    }
    const fare = distanceKm * this.fareRatePerKm;
    return fare.toFixed(2);
  }

  private roundDistanceKm(distanceKm: number): number {
    return Number(distanceKm.toFixed(3));
  }

  private buildQueueJobId(rideId: string): string {
    return `ride-${rideId}`;
  }

  private async removePendingJobs(rideId: string): Promise<void> {
    try {
      await this.rideQueue.remove(this.buildQueueJobId(rideId));
    } catch (error) {
      this.logger.warn(`Failed to remove queue job for ride ${rideId}: ${error}`);
    }
  }
}
