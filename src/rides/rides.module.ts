import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { Ride } from './domain/entities/ride.entity';
import { RideStatusHistory } from './domain/entities/ride-status-history.entity';
import { RideDriverCandidate } from './domain/entities/ride-driver-candidate.entity';
import { RidesService } from './domain/services/rides.service';
import { RideRepository } from './infrastructure/repositories/ride.repository';
import { RideStatusHistoryRepository } from './infrastructure/repositories/ride-status-history.repository';
import { RideDriverCandidateRepository } from './infrastructure/repositories/ride-driver-candidate.repository';
import { RIDE_QUEUE_NAME } from './domain/types/ride-queue.types';
import { RideProcessor } from './domain/processors/ride.processor';
import { BullBoardModule } from '@bull-board/nestjs';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { HttpModule } from '@nestjs/axios';
import type { RegisterQueueOptions } from '@nestjs/bullmq';
import type { QueueOptions } from 'bullmq';
import {
  ROUTE_ESTIMATION_QUEUE_LIMITER,
  QueueLimiterOptions,
} from './domain/constants/route-estimation-limiter.constant';
import { RideNotificationService } from './domain/services/ride-notification.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { LocationModule } from '../location/location.module';
import { TripTrack } from './domain/entities/trip-track.entity';
import { TripTrackRepository } from './infrastructure/repositories/trip-track.repository';
import { TripTrackingService } from './domain/services/trip-tracking.service';
import { TripTrackingProcessor } from './domain/processors/trip-tracking.processor';
import { TRIP_TRACKING_QUEUE_NAME } from './domain/constants/trip-tracking.constants';

type RideQueueRegistrationOptions = RegisterQueueOptions & {
  limiter?: QueueLimiterOptions;
};

const rideQueueRegistration: RideQueueRegistrationOptions = {
  name: RIDE_QUEUE_NAME,
  defaultJobOptions: {
    removeOnComplete: true,
    removeOnFail: 25,
  },
  limiter: ROUTE_ESTIMATION_QUEUE_LIMITER,
};

const tripTrackingQueueRegistration: RegisterQueueOptions = {
  name: TRIP_TRACKING_QUEUE_NAME,
  defaultJobOptions: {
    removeOnFail: 25,
  },
};

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Ride,
      RideStatusHistory,
      RideDriverCandidate,
      TripTrack,
    ]),
    BullModule.registerQueue(
      rideQueueRegistration,
      tripTrackingQueueRegistration,
    ),
    BullBoardModule.forFeature(
      {
        name: RIDE_QUEUE_NAME,
        adapter: BullMQAdapter,
      },
      {
        name: TRIP_TRACKING_QUEUE_NAME,
        adapter: BullMQAdapter,
      },
    ),
    HttpModule,
    NotificationsModule,
    LocationModule,
  ],
  providers: [
    RidesService,
    RideRepository,
    RideStatusHistoryRepository,
    RideDriverCandidateRepository,
    RideNotificationService,
    RideProcessor,
    TripTrackRepository,
    TripTrackingService,
    TripTrackingProcessor,
  ],
  exports: [RidesService],
})
export class RidesModule {}
