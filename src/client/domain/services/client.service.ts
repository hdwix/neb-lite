import { ConflictException, Injectable } from '@nestjs/common';
import { EClientType } from '../../../app/enums/client-type.enum';
import { RiderProfileRepository } from '../../../iam/infrastructure/repository/rider-profile.repository';
import { DriverProfileRepository } from '../../../iam/infrastructure/repository/driver-profile.repository';
import { SignupRiderDto } from '../../app/dto/signup-rider.dto';
import { SignupDriverDto } from '../../app/dto/signup-driver.dto';
import { DataEncryptionService } from './data-encryption.service';
import { EntityManager } from 'typeorm';

@Injectable()
export class ClientService {
  constructor(
    private readonly riderProfileRepository: RiderProfileRepository,
    private readonly driverProfileRepository: DriverProfileRepository,
    private readonly dataEncryptionService: DataEncryptionService,
  ) {}

  async signupRider(signupRiderDto: SignupRiderDto) {
    const encryptedName = this.dataEncryptionService.encrypt(
      signupRiderDto.name,
    );

    const rider = await this.riderProfileRepository.createRiderProfileWithLock(
      signupRiderDto.msisdn,
      encryptedName,
      async (manager) => {
        await this.ensureMsisdnExclusivity(
          manager,
          signupRiderDto.msisdn,
          EClientType.RIDER,
        );
      },
    );

    return {
      id: rider.id,
      msisdn: rider.msisdn,
      role: rider.role,
    };
  }

  async signupDriver(signupDriverDto: SignupDriverDto) {
    const encryptedDriverLicense = this.dataEncryptionService.encrypt(
      signupDriverDto.driverLicenseNumber,
    );
    const encryptedVehicleLicense = this.dataEncryptionService.encrypt(
      signupDriverDto.vehicleLicensePlate,
    );
    const encryptedName = this.dataEncryptionService.encrypt(
      signupDriverDto.name,
    );

    const driver = await this.driverProfileRepository.createDriverProfileWithLock(
      signupDriverDto.msisdn,
      encryptedDriverLicense,
      encryptedVehicleLicense,
      encryptedName,
      async (manager) => {
        await this.ensureMsisdnExclusivity(
          manager,
          signupDriverDto.msisdn,
          EClientType.DRIVER,
        );
      },
    );

    return {
      id: driver.id,
      msisdn: driver.msisdn,
      role: driver.role,
    };
  }

  private async ensureMsisdnExclusivity(
    manager: EntityManager,
    msisdn: string,
    clientType: EClientType,
  ) {
    const [riderProfiles, driverProfiles] = await Promise.all([
      this.riderProfileRepository.findRiderByPhone(msisdn, manager),
      this.driverProfileRepository.findDriverByPhone(msisdn, manager),
    ]);

    const riderExists = riderProfiles?.length > 0;
    const driverExists = driverProfiles?.length > 0;

    if (riderExists && driverExists) {
      throw new ConflictException(
        'msisdn is already registered as both rider and driver',
      );
    }

    if (clientType === EClientType.RIDER) {
      if (riderExists) {
        throw new ConflictException('msisdn is already registered as rider');
      }

      if (driverExists) {
        throw new ConflictException('msisdn is already registered as driver');
      }
    }

    if (clientType === EClientType.DRIVER) {
      if (driverExists) {
        throw new ConflictException('msisdn is already registered as driver');
      }

      if (riderExists) {
        throw new ConflictException('msisdn is already registered as rider');
      }
    }
  }

}
