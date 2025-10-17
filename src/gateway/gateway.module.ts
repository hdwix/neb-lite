import { Module } from '@nestjs/common';
import { GatewayController } from './app/controllers/gateway.controller';
import { IamModule } from '../iam/iam.module';
import { AuthenticationService } from '../iam/domain/services/authentication.service';
import { HashingService } from '../iam/domain/services/hashing.service';
import { BcryptService } from '../iam/domain/services/bcrypt.service';
import { APP_GUARD } from '@nestjs/core';
import { AccessRoleGuard } from '../iam/app/guards/access-role/access-role.guard';
import { AccessTokenGuard } from '../iam/app/guards/access-token/access-token.guard';
import { AuthenticationGuard } from '../iam/app/guards/authentication/authentication.guard';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { ConfigModule } from '@nestjs/config';
import jwtConfig from '../iam/app/config/jwt.config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RiderProfile } from '../iam/domain/entities/rider-profile.entity';
import { DriverProfile } from '../iam/domain/entities/driver-profile.entity';
import { RiderProfileRepository } from '../iam/infrastructure/repository/rider-profile.repository';
import { DriverProfileRepository } from '../iam/infrastructure/repository/driver-profile.repository';
import { DatabaseModule } from '../infrastructure/modules/database.module';
import { SmsProviderService } from '../iam/domain/services/sms-provider.service';
import { HttpService } from '@nestjs/axios';
import { LocationModule } from '../location/location.module';
import { RidesModule } from '../rides/rides.module';

@Module({
  imports: [
    DatabaseModule,
    IamModule,
    LocationModule,
    RidesModule,
    JwtModule.registerAsync(jwtConfig.asProvider()),
    ConfigModule.forFeature(jwtConfig),
    TypeOrmModule.forFeature([RiderProfile, DriverProfile]),
  ],
  controllers: [GatewayController],
  providers: [
    AuthenticationService,
    {
      provide: HashingService,
      useClass: BcryptService,
    },
    {
      provide: APP_GUARD,
      useClass: AuthenticationGuard,
    },
    {
      provide: APP_GUARD,
      useClass: AccessRoleGuard,
    },
    AccessTokenGuard,
    JwtService,
    RiderProfileRepository,
    DriverProfileRepository,
    SmsProviderService,
  ],
})
export class GatewayModule {}
