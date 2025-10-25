import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { EClientType } from '../../../app/enums/client-type.enum';
import { RiderProfileRepository } from '../../../iam/infrastructure/repository/rider-profile.repository';
import { DriverProfileRepository } from '../../../iam/infrastructure/repository/driver-profile.repository';
import { SignupRiderDto } from '../../app/dto/signup-rider.dto';
import { SignupDriverDto } from '../../app/dto/signup-driver.dto';
import { DataEncryptionService } from './data-encryption.service';
import { DataSource, EntityManager } from 'typeorm';

@Injectable()
export class ClientService {
  constructor(
    private readonly riderProfileRepository: RiderProfileRepository,
    private readonly driverProfileRepository: DriverProfileRepository,
    private readonly dataEncryptionService: DataEncryptionService,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  async signupRider(signupRiderDto: SignupRiderDto) {
    return this.dataSource.transaction(async (manager) => {
      await this.ensureMsisdnExclusivity(
        manager,
        signupRiderDto.msisdn,
        EClientType.RIDER,
      );

      const encryptedName = this.dataEncryptionService.encrypt(
        signupRiderDto.name,
      );

      const rider = await this.riderProfileRepository.createRiderProfile(
        signupRiderDto.msisdn,
        encryptedName,
        manager,
      );

      if (!rider) {
        throw new InternalServerErrorException('Failed to create rider profile');
      }

      return {
        id: rider.id,
        msisdn: rider.msisdn,
        role: rider.role,
      };
    });
  }

  async signupDriver(signupDriverDto: SignupDriverDto) {
    return this.dataSource.transaction(async (manager) => {
      await this.ensureMsisdnExclusivity(
        manager,
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
        manager,
      );

      if (!driver) {
        throw new InternalServerErrorException('Failed to create driver profile');
      }

      return {
        id: driver.id,
        msisdn: driver.msisdn,
        role: driver.role,
      };
    });
  }

  private async ensureMsisdnExclusivity(
    manager: EntityManager,
    msisdn: string,
    clientType: EClientType,
  ) {
    await manager.query(
      `
        INSERT INTO client_msisdn_lock (msisdn, client_type)
        VALUES ($1, $2)
        ON CONFLICT (msisdn) DO NOTHING
      `,
      [msisdn, clientType],
    );

    const [lockRow] = await manager.query(
      `
        SELECT client_type
        FROM client_msisdn_lock
        WHERE msisdn = $1
        FOR UPDATE
      `,
      [msisdn],
    );

    if (!lockRow) {
      throw new InternalServerErrorException('Failed to secure msisdn exclusivity');
    }

    const riderProfiles = await this.riderProfileRepository.findRiderByPhone(
      msisdn,
      manager,
    );
    const driverProfiles = await this.driverProfileRepository.findDriverByPhone(
      msisdn,
      manager,
    );

    const riderExists = riderProfiles?.length > 0;
    const driverExists = driverProfiles?.length > 0;

    const existingType = lockRow.client_type as EClientType | undefined;

    if (existingType && existingType !== clientType) {
      throw new ConflictException(
        existingType === EClientType.RIDER
          ? 'msisdn is already registered as rider'
          : 'msisdn is already registered as driver',
      );
    }

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
