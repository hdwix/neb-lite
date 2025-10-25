import { Module } from '@nestjs/common';
import { ClientService } from './domain/services/client.service';
import { RiderProfileRepository } from '../iam/infrastructure/repository/rider-profile.repository';
import { DriverProfileRepository } from '../iam/infrastructure/repository/driver-profile.repository';
import { DataEncryptionService } from './domain/services/data-encryption.service';
import { DatabaseModule } from '../infrastructure/modules/database.module';
import { ClientSignupRepository } from './infrastructure/repository/client-signup.repository';

@Module({
  imports: [DatabaseModule],
  controllers: [],
  providers: [
    ClientService,
    RiderProfileRepository,
    DriverProfileRepository,
    DataEncryptionService,
    ClientSignupRepository,
  ],
  exports: [ClientService],
})
export class ClientModule {}
