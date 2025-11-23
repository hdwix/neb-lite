import { ConflictException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { ClientService } from './client.service';
import { RiderProfileRepository } from '../../../iam/infrastructure/repository/rider-profile.repository';
import { DriverProfileRepository } from '../../../iam/infrastructure/repository/driver-profile.repository';
import { DataEncryptionService } from './data-encryption.service';
import { SignupRiderDto } from '../../app/dto/signup-rider.dto';
import { SignupDriverDto } from '../../app/dto/signup-driver.dto';
import { EClientType } from '../../../app/enums/client-type.enum';

describe('ClientService', () => {
  let service: ClientService;
  let riderProfileRepository: {
    createRiderProfileWithLock: jest.Mock;
    findRiderByPhone: jest.Mock;
  };
  let driverProfileRepository: {
    createDriverProfileWithLock: jest.Mock;
    findDriverByPhone: jest.Mock;
  };
  let dataEncryptionService: {
    encrypt: jest.Mock;
  };

  beforeEach(() => {
    riderProfileRepository = {
      createRiderProfileWithLock: jest.fn(),
      findRiderByPhone: jest.fn().mockResolvedValue([]),
    };
    driverProfileRepository = {
      createDriverProfileWithLock: jest.fn(),
      findDriverByPhone: jest.fn().mockResolvedValue([]),
    };
    dataEncryptionService = {
      encrypt: jest.fn((value: string) => `secure-${value}`),
    };
    service = new ClientService(
      riderProfileRepository as unknown as RiderProfileRepository,
      driverProfileRepository as unknown as DriverProfileRepository,
      dataEncryptionService as unknown as DataEncryptionService,
    );
  });

  describe('signupRider', () => {
    it('encrypts rider data, enforces exclusivity, and returns minimal profile', async () => {
      const dto: SignupRiderDto = {
        msisdn: '+621234',
        name: 'John Rider',
      } as SignupRiderDto;
      const transactionalManager = { id: 'manager' } as unknown as EntityManager;
      riderProfileRepository.createRiderProfileWithLock.mockImplementation(
        async (_msisdn: string, encryptedName: string, beforeInsert?: Function) => {
          expect(encryptedName).toBe('secure-John Rider');
          if (beforeInsert) {
            await beforeInsert(transactionalManager);
          }
          return { id: 'rider-1', msisdn: dto.msisdn, role: EClientType.RIDER };
        },
      );

      const result = await service.signupRider(dto);

      expect(result).toEqual({ id: 'rider-1', msisdn: dto.msisdn, role: EClientType.RIDER });
      expect(dataEncryptionService.encrypt).toHaveBeenCalledWith(dto.name);
      expect(riderProfileRepository.findRiderByPhone).toHaveBeenCalledWith(
        dto.msisdn,
        transactionalManager,
      );
      expect(driverProfileRepository.findDriverByPhone).toHaveBeenCalledWith(
        dto.msisdn,
        transactionalManager,
      );
    });
  });

  describe('signupDriver', () => {
    it('encrypts driver data and ensures phone number exclusivity', async () => {
      const dto: SignupDriverDto = {
        msisdn: '+620001',
        name: 'Driver Doe',
        driverLicenseNumber: 'DL-01',
        vehicleLicensePlate: 'AB1234',
      } as SignupDriverDto;
      const transactionalManager = { id: 'driver-manager' } as unknown as EntityManager;
      driverProfileRepository.createDriverProfileWithLock.mockImplementation(
        async (
          _msisdn: string,
          encryptedDriverLicense: string,
          encryptedVehicleLicense: string,
          encryptedName: string,
          beforeInsert?: Function,
        ) => {
          expect(encryptedDriverLicense).toBe('secure-DL-01');
          expect(encryptedVehicleLicense).toBe('secure-AB1234');
          expect(encryptedName).toBe('secure-Driver Doe');
          if (beforeInsert) {
            await beforeInsert(transactionalManager);
          }
          return { id: 'driver-1', msisdn: dto.msisdn, role: EClientType.DRIVER };
        },
      );

      const result = await service.signupDriver(dto);

      expect(result).toEqual({ id: 'driver-1', msisdn: dto.msisdn, role: EClientType.DRIVER });
      expect(dataEncryptionService.encrypt).toHaveBeenNthCalledWith(1, dto.driverLicenseNumber);
      expect(dataEncryptionService.encrypt).toHaveBeenNthCalledWith(2, dto.vehicleLicensePlate);
      expect(dataEncryptionService.encrypt).toHaveBeenNthCalledWith(3, dto.name);
      expect(riderProfileRepository.findRiderByPhone).toHaveBeenCalledWith(
        dto.msisdn,
        transactionalManager,
      );
      expect(driverProfileRepository.findDriverByPhone).toHaveBeenCalledWith(
        dto.msisdn,
        transactionalManager,
      );
    });
  });

  describe('ensureMsisdnExclusivity', () => {
    const manager = {} as EntityManager;

    it('throws when msisdn is already registered as both rider and driver', async () => {
      riderProfileRepository.findRiderByPhone.mockResolvedValueOnce([{}]);
      driverProfileRepository.findDriverByPhone.mockResolvedValueOnce([{}]);

      await expect(
        (service as any).ensureMsisdnExclusivity(manager, '+62', EClientType.RIDER),
      ).rejects.toThrow(
        new ConflictException('msisdn is already registered as both rider and driver'),
      );
    });

    it('throws when signing up rider and rider profile exists', async () => {
      riderProfileRepository.findRiderByPhone.mockResolvedValueOnce([{}]);
      driverProfileRepository.findDriverByPhone.mockResolvedValueOnce([]);

      await expect(
        (service as any).ensureMsisdnExclusivity(manager, '+62', EClientType.RIDER),
      ).rejects.toThrow(new ConflictException('msisdn is already registered as rider'));
    });

    it('throws when signing up rider and driver profile exists', async () => {
      riderProfileRepository.findRiderByPhone.mockResolvedValueOnce([]);
      driverProfileRepository.findDriverByPhone.mockResolvedValueOnce([{}]);

      await expect(
        (service as any).ensureMsisdnExclusivity(manager, '+62', EClientType.RIDER),
      ).rejects.toThrow(new ConflictException('msisdn is already registered as driver'));
    });

    it('throws when signing up driver and driver profile exists', async () => {
      riderProfileRepository.findRiderByPhone.mockResolvedValueOnce([]);
      driverProfileRepository.findDriverByPhone.mockResolvedValueOnce([{}]);

      await expect(
        (service as any).ensureMsisdnExclusivity(manager, '+62', EClientType.DRIVER),
      ).rejects.toThrow(new ConflictException('msisdn is already registered as driver'));
    });

    it('throws when signing up driver and rider profile exists', async () => {
      riderProfileRepository.findRiderByPhone.mockResolvedValueOnce([{}]);
      driverProfileRepository.findDriverByPhone.mockResolvedValueOnce([]);

      await expect(
        (service as any).ensureMsisdnExclusivity(manager, '+62', EClientType.DRIVER),
      ).rejects.toThrow(new ConflictException('msisdn is already registered as rider'));
    });
  });
});
