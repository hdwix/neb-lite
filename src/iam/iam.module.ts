import { Module } from '@nestjs/common';
import { AuthenticationController } from './app/controllers/authentication.controller';
import { AuthenticationService } from './domain/services/authentication.service';
import { BcryptService } from './domain/services/bcrypt.service';
import { HashingService } from './domain/services/hashing.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import jwtConfig from './app/config/jwt.config';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { AccessTokenGuard } from './app/guards/access-token/access-token.guard';
import { AuthenticationGuard } from './app/guards/authentication/authentication.guard';
import { AccessRoleGuard } from './app/guards/access-role/access-role.guard';
import { SmsProviderService } from './domain/services/sms-provider.service';
import { RiderProfileRepository } from './infrastructure/repository/rider-profile.repository';
import { DriverProfileRepository } from './infrastructure/repository/driver-profile.repository';
import { RiderProfile } from './domain/entities/rider-profile.entity';
import { DriverProfile } from './domain/entities/driver-profile.entity';
// import { HttpModule } from '@nestjs/axios';

@Module({
  imports: [
    TypeOrmModule.forFeature([RiderProfile, DriverProfile]),
    // HttpModule,
    JwtModule.registerAsync(jwtConfig.asProvider()),
    ConfigModule.forFeature(jwtConfig),
  ],
  controllers: [AuthenticationController],
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
    RiderProfileRepository,
    DriverProfileRepository,
  ],
})
export class IamModule {}
