import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bull';
import { LocationService } from './domain/services/location.service';
import { GeolocationRepository } from './domain/services/geolocation.repository';
import { LocationProcessor } from './domain/processors/location.processor';
import { LOCATION_QUEUE_NAME } from './domain/services/location.types';

@Module({
  imports: [
    ConfigModule,
    BullModule.registerQueue({ name: LOCATION_QUEUE_NAME }),
  ],
  providers: [LocationService, GeolocationRepository, LocationProcessor],
  exports: [LocationService],
})
export class LocationModule {}
