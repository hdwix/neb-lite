import { Module } from '@nestjs/common';
import { LocationController } from './app/controllers/location.controller';
import { LocationService } from './domain/services/location.service';

@Module({
  controllers: [LocationController],
  providers: [LocationService]
})
export class LocationModule {}
