import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { LocationService } from './domain/services/location.service';
import { GeolocationRepository } from './domain/services/geolocation.repository';
import { LocationProcessor } from './domain/processors/location.processor';
import {
  LOCATION_QUEUE_NAME,
  MAINTENANCE_CLEANUP_IDLE_DRIVERS,
} from './domain/services/location.types';
import { BullBoardModule } from '@bull-board/nestjs';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';

@Module({
  imports: [
    ConfigModule,
    BullModule.registerQueue(
      {
        name: LOCATION_QUEUE_NAME,
      },
      {
        name: MAINTENANCE_CLEANUP_IDLE_DRIVERS,
      },
    ),
    BullBoardModule.forFeature(
      {
        name: LOCATION_QUEUE_NAME,
        adapter: BullMQAdapter,
      },
      {
        name: MAINTENANCE_CLEANUP_IDLE_DRIVERS,
        adapter: BullMQAdapter,
      },
    ),
  ],
  providers: [LocationService, GeolocationRepository, LocationProcessor],
  exports: [LocationService],
})
export class LocationModule {}
