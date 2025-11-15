import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { Ride } from './domain/entities/ride.entity';
import { RideStatusHistory } from './domain/entities/ride-status-history.entity';
import { RideDriverCandidate } from './domain/entities/ride-driver-candidate.entity';
import { RidePaymentDetail } from './domain/entities/ride-payment-detail.entity';
import { PaymentIpWhitelist } from './domain/entities/payment-ip-whitelist.entity';
import { PaymentOutbox } from './domain/entities/payment-outbox.entity';
import { RidesService } from './domain/services/rides.service';
import { RideRepository } from './infrastructure/repositories/ride.repository';
import { RideStatusHistoryRepository } from './infrastructure/repositories/ride-status-history.repository';
import { RideDriverCandidateRepository } from './infrastructure/repositories/ride-driver-candidate.repository';
import { RidePaymentDetailRepository } from './infrastructure/repositories/ride-payment-detail.repository';
import { PaymentIpWhitelistRepository } from './infrastructure/repositories/payment-ip-whitelist.repository';
import { PaymentOutboxRepository } from './infrastructure/repositories/payment-outbox.repository';
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
import { TripSummary } from './domain/entities/trip-summary.entity';
import { TripTrackRepository } from './infrastructure/repositories/trip-track.repository';
import { TripSummaryRepository } from './infrastructure/repositories/trip-summary.repository';
import { TripTrackingService } from './domain/services/trip-tracking.service';
import { TripTrackingProcessor } from './domain/processors/trip-tracking.processor';
import { TRIP_TRACKING_QUEUE_NAME } from './domain/constants/trip-tracking.constants';
import {
  PAYMENT_QUEUE_BACKOFF_MS,
  PAYMENT_QUEUE_NAME,
  PAYMENT_QUEUE_ATTEMPTS,
} from './domain/constants/payment.constants';
import { PaymentService } from './domain/services/payment.service';
import { PaymentProcessor } from './domain/processors/payment.processor';
import { RidePaymentRepository } from './infrastructure/repositories/ride-payment.repository';

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

const paymentQueueRegistration: RegisterQueueOptions = {
  name: PAYMENT_QUEUE_NAME,
  defaultJobOptions: {
    removeOnFail: 50,
    removeOnComplete: 50,
    attempts: PAYMENT_QUEUE_ATTEMPTS,
    backoff: { type: 'exponential', delay: PAYMENT_QUEUE_BACKOFF_MS },
  },
};

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Ride,
      RideStatusHistory,
      RideDriverCandidate,
      TripTrack,
      TripSummary,
      RidePaymentDetail,
      PaymentIpWhitelist,
      PaymentOutbox,
    ]),
    BullModule.registerQueue(
      rideQueueRegistration,
      tripTrackingQueueRegistration,
      paymentQueueRegistration,
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
      {
        name: PAYMENT_QUEUE_NAME,
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
    TripSummaryRepository,
    TripTrackingService,
    TripTrackingProcessor,
    RidePaymentDetailRepository,
    RidePaymentRepository,
    PaymentIpWhitelistRepository,
    PaymentOutboxRepository,
    PaymentService,
    PaymentProcessor,
  ],
  exports: [RidesService],
})
export class RidesModule {}
