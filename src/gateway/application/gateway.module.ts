import { Module } from '@nestjs/common';
import { GatewayController } from '../infrastructure/http/gateway.controller';
import { IamModule } from '../../iam/iam.module';
import { DatabaseModule } from '../../infrastructure/modules/database.module';
import { LocationModule } from '../../location/location.module';
import { RidesModule } from '../../rides/rides.module';
import { NotificationsModule } from '../../notifications/application/notifications.module';
import { ClientModule } from '../../client/client.module';

@Module({
  imports: [
    DatabaseModule,
    IamModule,
    LocationModule,
    RidesModule,
    NotificationsModule,
    ClientModule,
  ],
  controllers: [GatewayController],
})
export class GatewayModule {}
