import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { LocationService } from './domain/services/location.service';
import { GeolocationRepository } from './domain/services/geolocation.repository';
import { LocationProcessor } from './domain/processors/location.processor';
import {
  LOCATION_QUEUE_NAME,
  MAINTENANCE_QUEUE_NAME,
} from './domain/services/location.types';
import { BullBoardModule } from '@bull-board/nestjs';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { RedisWorkerModule } from '../redis-worker/redis-worker.module';

@Module({
  imports: [
    ConfigModule,
    BullModule.registerQueue(
      {
        name: LOCATION_QUEUE_NAME,
      },
      {
        name: MAINTENANCE_QUEUE_NAME,
      },
    ),
    BullBoardModule.forFeature(
      {
        name: LOCATION_QUEUE_NAME,
        adapter: BullMQAdapter,
      },
      {
        name: MAINTENANCE_QUEUE_NAME,
        adapter: BullMQAdapter,
      },
    ),
  ],
  providers: [LocationService, GeolocationRepository, LocationProcessor],
  exports: [LocationService],
})
export class LocationModule {}
