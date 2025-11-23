import { Module } from '@nestjs/common';
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
import { SmsProcessor } from './domain/services/sms-processor';
import { RiderProfileRepository } from './infrastructure/repository/rider-profile.repository';
import { DriverProfileRepository } from './infrastructure/repository/driver-profile.repository';
import { RiderProfile } from './domain/entities/rider-profile.entity';
import { DriverProfile } from './domain/entities/driver-profile.entity';
import { HttpModule } from '@nestjs/axios';
import { BullModule } from '@nestjs/bullmq';
import { QueueLimiterOptions } from '../rides/domain/constants/route-estimation-limiter.constant';
import {
  QueueRegistrationOptions,
  SEND_OTP_QUEUE_LIMITER,
  SEND_OTP_QUEUE_NAME,
} from './app/types/iam-module-types-definition';
import { BullBoardModule } from '@bull-board/nestjs';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { NotificationsModule } from '../notifications/notifications.module';

const sendOtpQueueRegistration: QueueRegistrationOptions = {
  name: SEND_OTP_QUEUE_NAME,
  defaultJobOptions: {
    removeOnComplete: true,
    removeOnFail: 25,
  },
  limiter: SEND_OTP_QUEUE_LIMITER,
};

@Module({
  imports: [
    TypeOrmModule.forFeature([RiderProfile, DriverProfile]),
    HttpModule,
    JwtModule.registerAsync(jwtConfig.asProvider()),
    ConfigModule.forFeature(jwtConfig),
    BullModule.registerQueue(sendOtpQueueRegistration),
    BullBoardModule.forFeature({
      name: SEND_OTP_QUEUE_NAME,
      adapter: BullMQAdapter,
    }),
    NotificationsModule,
  ],
  controllers: [],
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
    SmsProcessor,
  ],
  exports: [HttpModule, AuthenticationService],
})
export class IamModule {}
