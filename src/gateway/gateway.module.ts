import { Module } from '@nestjs/common';
import { GatewayController } from './app/controllers/gateway.controller';
import { IamModule } from '../iam/iam.module';
import { DatabaseModule } from '../infrastructure/modules/database.module';
import { LocationModule } from '../location/location.module';
import { RidesModule } from '../rides/rides.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    DatabaseModule,
    IamModule,
    LocationModule,
    RidesModule,
    NotificationsModule,
  ],
  controllers: [GatewayController],
})
export class GatewayModule {}
