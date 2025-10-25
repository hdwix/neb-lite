import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { EClientType } from '../../../app/enums/client-type.enum';
import { RiderProfileRepository } from '../../../iam/infrastructure/repository/rider-profile.repository';
import { DriverProfileRepository } from '../../../iam/infrastructure/repository/driver-profile.repository';
import { SignupRiderDto } from '../../app/dto/signup-rider.dto';
import { SignupDriverDto } from '../../app/dto/signup-driver.dto';
import { DataEncryptionService } from './data-encryption.service';

@Injectable()
export class ClientService {
  constructor(
    private readonly riderProfileRepository: RiderProfileRepository,
    private readonly driverProfileRepository: DriverProfileRepository,
    private readonly dataEncryptionService: DataEncryptionService,
  ) {}

  async signupRider(signupRiderDto: SignupRiderDto) {
    await this.ensureMsisdnExclusivity(signupRiderDto.msisdn, EClientType.RIDER);

    const encryptedName = this.dataEncryptionService.encrypt(
      signupRiderDto.name,
    );

    const rider = await this.riderProfileRepository.createRiderProfile(
      signupRiderDto.msisdn,
      encryptedName,
    );

    if (!rider) {
      throw new InternalServerErrorException('Failed to create rider profile');
    }

    return {
      id: rider.id,
      msisdn: rider.msisdn,
      role: rider.role,
    };
  }

  async signupDriver(signupDriverDto: SignupDriverDto) {
    await this.ensureMsisdnExclusivity(
      signupDriverDto.msisdn,
      EClientType.DRIVER,
    );

    const encryptedDriverLicense = this.dataEncryptionService.encrypt(
      signupDriverDto.driverLicenseNumber,
    );
    const encryptedVehicleLicense = this.dataEncryptionService.encrypt(
      signupDriverDto.vehicleLicensePlate,
    );
    const encryptedName = this.dataEncryptionService.encrypt(
      signupDriverDto.name,
    );

    const driver = await this.driverProfileRepository.createDriverProfile(
      signupDriverDto.msisdn,
      encryptedDriverLicense,
      encryptedVehicleLicense,
      encryptedName,
    );

    if (!driver) {
      throw new InternalServerErrorException('Failed to create driver profile');
    }

    return {
      id: driver.id,
      msisdn: driver.msisdn,
      role: driver.role,
    };
  }

  private async ensureMsisdnExclusivity(
    msisdn: string,
    clientType: EClientType,
  ) {
    const riderProfiles = await this.riderProfileRepository.findRiderByPhone(
      msisdn,
    );
    const driverProfiles = await this.driverProfileRepository.findDriverByPhone(
      msisdn,
    );

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
