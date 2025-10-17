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
import { GeolocationRepository } from '../location/domain/services/geolocation.repository';

@Module({
  imports: [
    TypeOrmModule.forFeature([Ride, RideStatusHistory]),
    BullModule.registerQueue({
      name: RIDE_QUEUE_NAME,
      defaultJobOptions: {
        removeOnComplete: true,
        removeOnFail: 25,
      },
    }),
    BullBoardModule.forFeature({
      name: RIDE_QUEUE_NAME,
      adapter: BullMQAdapter,
    }),
  ],
  providers: [
    RidesService,
    RideRepository,
    RideStatusHistoryRepository,
    RideProcessor,
    GeolocationRepository,
  ],
  exports: [RidesService],
})
export class RidesModule {}
