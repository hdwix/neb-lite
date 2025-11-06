import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import Redis from 'ioredis';
import { Queue, RepeatOptions } from 'bullmq';
import { REDIS_CLIENT } from '../../../infrastructure/redis/redis.tokens';
import { TripTrackRepository } from '../../infrastructure/repositories/trip-track.repository';
import { TripTrack, TripTrackParticipantRole } from '../entities/trip-track.entity';
import {
  TRIP_TRACKING_QUEUE_NAME,
  TripTrackingQueueJob,
  TripTrackingJobData,
} from '../constants/trip-tracking.constants';

interface ParticipantLocation {
  longitude: number;
  latitude: number;
  accuracyMeters?: number | null;
  recordedAt: string;
}

interface TripTrackState {
  rideId: string;
  lastDriverLocation?: ParticipantLocation;
  lastRiderLocation?: ParticipantLocation;
  totalDistanceMeters: number;
  completed?: boolean;
}

interface TrackEvent {
  role: TripTrackParticipantRole;
  participantId: string;
  longitude: number;
  latitude: number;
  recordedAt: string;
  accuracyMeters?: number | null;
  distanceDeltaMeters: number;
  totalDistanceMeters: number;
}

const ACTIVE_RIDES_SET_KEY = 'trip:active';
const TRACK_STATE_KEY_PREFIX = 'trip:state:';
const TRACK_EVENTS_KEY_PREFIX = 'trip:events:';

@Injectable()
export class TripTrackingService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TripTrackingService.name);
  private readonly flushIntervalMs: number;
  private readonly flushAllJobId = 'trip-tracking:flush-all';

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly configService: ConfigService,
    private readonly tripTrackRepository: TripTrackRepository,
    @InjectQueue(TRIP_TRACKING_QUEUE_NAME)
    private readonly tripTrackingQueue: Queue<TripTrackingJobData>,
  ) {
    const interval = Number(
      this.configService.get<number>('TRIP_TRACKING_FLUSH_INTERVAL_MS') ??
        60_000,
    );
    this.flushIntervalMs = Number.isFinite(interval) && interval > 0 ? interval : 60_000;
  }

  async onModuleInit(): Promise<void> {
    await this.ensureFlushScheduler();
  }

  async onModuleDestroy(): Promise<void> {
    await this.flushAll().catch((error) =>
      this.logger.error(`Failed to flush trip tracking data on shutdown: ${error}`),
    );
  }

  async recordLocation(
    rideId: string,
    participantId: string,
    role: TripTrackParticipantRole,
    location: ParticipantLocation,
  ): Promise<{ totalDistanceMeters: number; distanceDeltaMeters: number }> {
    const stateKey = this.getStateKey(rideId);
    const eventsKey = this.getEventsKey(rideId);

    const state = await this.getState(rideId);
    const previousLocation =
      role === 'driver' ? state.lastDriverLocation : state.lastRiderLocation;

    const distanceDelta =
      role === 'driver' && previousLocation
        ? await this.calculateDistanceBetweenCoordinates(previousLocation, location)
        : 0;

    const totalDistance =
      role === 'driver' ? state.totalDistanceMeters + distanceDelta : state.totalDistanceMeters;

    const updatedState: TripTrackState = {
      ...state,
      totalDistanceMeters: totalDistance,
      lastDriverLocation:
        role === 'driver'
          ? location
          : state.lastDriverLocation,
      lastRiderLocation:
        role === 'rider'
          ? location
          : state.lastRiderLocation,
    };

    await Promise.all([
      this.redis.set(stateKey, JSON.stringify(updatedState), 'EX', 60 * 60),
      this.redis.sadd(ACTIVE_RIDES_SET_KEY, rideId),
    ]);

    const event: TrackEvent = {
      role,
      participantId,
      longitude: location.longitude,
      latitude: location.latitude,
      recordedAt: location.recordedAt,
      accuracyMeters: location.accuracyMeters ?? null,
      distanceDeltaMeters: distanceDelta,
      totalDistanceMeters: totalDistance,
    };

    await Promise.all([
      this.redis.rpush(eventsKey, JSON.stringify(event)),
      this.redis.expire(eventsKey, 60 * 60),
    ]);

    return {
      totalDistanceMeters: totalDistance,
      distanceDeltaMeters: distanceDelta,
    };
  }

  async getLatestLocation(
    rideId: string,
    role: TripTrackParticipantRole,
  ): Promise<ParticipantLocation | null> {
    const state = await this.getState(rideId);
    if (role === 'driver') {
      return state.lastDriverLocation ?? null;
    }
    return state.lastRiderLocation ?? null;
  }

  async getTotalDistanceMeters(rideId: string): Promise<number> {
    const state = await this.getState(rideId);
    return state.totalDistanceMeters;
  }

  async markRideCompleted(rideId: string): Promise<void> {
    const state = await this.getState(rideId);
    if (!state.completed) {
      state.completed = true;
      await this.redis.set(this.getStateKey(rideId), JSON.stringify(state), 'EX', 60 * 60);
      await this.enqueueFlushRideJob(rideId);
    }
  }

  async flushAll(): Promise<void> {
    const rideIds = await this.redis.smembers(ACTIVE_RIDES_SET_KEY);
    if (!rideIds.length) {
      return;
    }

    await Promise.all(
      rideIds.map(async (rideId) => {
        try {
          await this.flushRide(rideId);
        } catch (error) {
          this.logger.error(
            `Failed to flush trip tracking data for ride ${rideId}: ${error}`,
          );
        }
      }),
    );
  }

  public async flushRide(rideId: string): Promise<void> {
    const eventsKey = this.getEventsKey(rideId);
    const eventPayloads = await this.redis.lrange(eventsKey, 0, -1);

    if (!eventPayloads.length) {
      const state = await this.getState(rideId);
      if (state.completed) {
        await this.cleanupRide(rideId);
      }
      return;
    }

    await this.redis.del(eventsKey);

    const entries: TripTrack[] = [];
    for (const payload of eventPayloads) {
      try {
        const event = JSON.parse(payload) as TrackEvent;
        entries.push(
          this.tripTrackRepository.create({
            rideId,
            participantId: event.participantId,
            participantRole: event.role,
            longitude: event.longitude,
            latitude: event.latitude,
            distanceDeltaMeters: event.distanceDeltaMeters,
            totalDistanceMeters: event.totalDistanceMeters,
            recordedAt: new Date(event.recordedAt),
          }),
        );
      } catch (error) {
        this.logger.warn(
          `Unable to parse trip tracking event for ride ${rideId}: ${error}`,
        );
      }
    }

    await this.tripTrackRepository.saveMany(entries);

    const state = await this.getState(rideId);
    if (state.completed) {
      const remaining = await this.redis.llen(eventsKey);
      if (remaining === 0) {
        await this.cleanupRide(rideId);
      }
    }
  }

  private async cleanupRide(rideId: string): Promise<void> {
    await Promise.all([
      this.redis.del(this.getStateKey(rideId)),
      this.redis.del(this.getEventsKey(rideId)),
      this.redis.srem(ACTIVE_RIDES_SET_KEY, rideId),
    ]);
  }

  private async getState(rideId: string): Promise<TripTrackState> {
    const payload = await this.redis.get(this.getStateKey(rideId));
    if (!payload) {
      const initial: TripTrackState = {
        rideId,
        totalDistanceMeters: 0,
      };
      return initial;
    }

    try {
      const parsed = JSON.parse(payload) as TripTrackState;
      return {
        rideId,
        totalDistanceMeters: parsed.totalDistanceMeters ?? 0,
        lastDriverLocation: parsed.lastDriverLocation,
        lastRiderLocation: parsed.lastRiderLocation,
        completed: parsed.completed ?? false,
      };
    } catch (error) {
      this.logger.warn(
        `Unable to parse trip tracking state for ride ${rideId}: ${error}`,
      );
      return {
        rideId,
        totalDistanceMeters: 0,
      };
    }
  }

  public async calculateDistanceBetweenCoordinates(
    origin: { longitude: number; latitude: number },
    destination: { longitude: number; latitude: number },
  ): Promise<number> {
    return this.calculateDistanceMeters(
      origin.longitude,
      origin.latitude,
      destination.longitude,
      destination.latitude,
    );
  }

  private async calculateDistanceMeters(
    lon1: number,
    lat1: number,
    lon2: number,
    lat2: number,
  ): Promise<number> {
    const key = `trip:distance:${randomUUID()}`;
    const pipeline = this.redis.pipeline();

    pipeline.geoadd(key, lon1, lat1, 'point:origin');
    pipeline.geoadd(key, lon2, lat2, 'point:destination');
    pipeline.geodist(key, 'point:origin', 'point:destination', 'm');
    pipeline.del(key);

    try {
      const results = await pipeline.exec();
      const distanceResult = results?.[2];

      if (!distanceResult || distanceResult[0]) {
        return 0;
      }

      const value = distanceResult[1];
      const distance =
        typeof value === 'number' ? value : Number.parseFloat(String(value));

      return Number.isFinite(distance) ? distance : 0;
    } catch (error) {
      this.logger.error(`Failed to calculate geo distance via redis: ${error}`);
      return 0;
    } finally {
      await this.redis.del(key).catch(() => undefined);
    }
  }

  private getStateKey(rideId: string): string {
    return `${TRACK_STATE_KEY_PREFIX}${rideId}`;
  }

  private getEventsKey(rideId: string): string {
    return `${TRACK_EVENTS_KEY_PREFIX}${rideId}`;
  }

  private async ensureFlushScheduler(): Promise<void> {
    const repeatableJobs = await this.tripTrackingQueue.getRepeatableJobs();
    const existingJob = repeatableJobs.find(
      (job) => job.name === TripTrackingQueueJob.FlushAll,
    );

    const expectedEvery = this.flushIntervalMs;
    const repeat: RepeatOptions = { every: expectedEvery };

    if (existingJob) {
      const existingEvery =
        existingJob.every == null
          ? null
          : typeof existingJob.every === 'string'
          ? Number.parseInt(existingJob.every, 10)
          : existingJob.every;

      if (existingEvery === expectedEvery) {
        return;
      }

      await this.tripTrackingQueue.removeRepeatableByKey(existingJob.key);
    }

    await this.tripTrackingQueue.add(
      TripTrackingQueueJob.FlushAll,
      {},
      {
        jobId: this.flushAllJobId,
        repeat,
        removeOnComplete: true,
        removeOnFail: { count: 25 },
      },
    );
  }

  private async enqueueFlushRideJob(rideId: string): Promise<void> {
    const jobId = `trip-tracking:flush-ride:${rideId}`;

    try {
      await this.tripTrackingQueue.add(
        TripTrackingQueueJob.FlushRide,
        { rideId },
        {
          jobId,
          removeOnComplete: true,
          removeOnFail: { count: 25 },
        },
      );
    } catch (error) {
      if (this.isJobIdAlreadyExistsError(error)) {
        this.logger.debug(
          `Flush ride job already queued for ride ${rideId}; skipping duplicate`,
        );
        return;
      }

      throw error;
    }
  }

  private isJobIdAlreadyExistsError(error: unknown): boolean {
    if (!error || typeof error !== 'object') {
      return false;
    }

    const message = 'message' in error ? String(error.message) : '';
    const name = 'name' in error ? String(error.name) : '';

    return (
      name === 'JobIdAlreadyExistsError' || message.includes('JobIdAlreadyExists')
    );
  }
}

export type { ParticipantLocation };
