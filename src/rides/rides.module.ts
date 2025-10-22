import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { Ride } from './domain/entities/ride.entity';
import { RideStatusHistory } from './domain/entities/ride-status-history.entity';
import { RidesService } from './domain/services/rides.service';
import { RideRepository } from './infrastructure/repositories/ride.repository';
import { RideStatusHistoryRepository } from './infrastructure/repositories/ride-status-history.repository';
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

@Module({
  imports: [
    TypeOrmModule.forFeature([Ride, RideStatusHistory]),
    BullModule.registerQueue(rideQueueRegistration),
    BullBoardModule.forFeature({
      name: RIDE_QUEUE_NAME,
      adapter: BullMQAdapter,
    }),
    HttpModule,
  ],
  providers: [
    RidesService,
    RideRepository,
    RideStatusHistoryRepository,
    RideNotificationService,
    RideProcessor,
  ],
  exports: [RidesService],
})
export class RidesModule {}
