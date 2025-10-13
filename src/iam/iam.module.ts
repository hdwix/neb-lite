import { Module } from '@nestjs/common';
import { AuthenticationController } from './app/controllers/authentication.controller';
import { AuthenticationService } from './domain/services/authentication.service';
import { BcryptService } from './domain/services/bcrypt.service';
import { HashingService } from './domain/services/hashing.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NebengjekClient } from './domain/entities/nebengjek-client.entity';
import { NebengjekClientRepository } from './infrastructure/repository/nebengjek-client.repository';
import { JwtModule } from '@nestjs/jwt';
import jwtConfig from './app/config/jwt.config';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { AccessTokenGuard } from './app/guards/access-token/access-token.guard';
import { AuthenticationGuard } from './app/guards/authentication/authentication.guard';
import { AccessRoleGuard } from './app/guards/access-role/access-role.guard';
import { SmsProviderService } from './domain/services/sms-provider.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([NebengjekClient]),
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
    NebengjekClientRepository,
    AccessTokenGuard,
    SmsProviderService,
  ],
})
export class IamModule {}
