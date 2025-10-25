import { Test, TestingModule } from '@nestjs/testing';
import { ClientService } from './client.service';
import { RiderProfileRepository } from '../../../iam/infrastructure/repository/rider-profile.repository';
import { DriverProfileRepository } from '../../../iam/infrastructure/repository/driver-profile.repository';
import { DataEncryptionService } from './data-encryption.service';

describe('ClientService', () => {
  let service: ClientService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClientService,
        {
          provide: RiderProfileRepository,
          useValue: {
            createRiderProfileWithLock: jest
              .fn()
              .mockImplementation(async (_msisdn, _name, beforeInsert) => {
                if (beforeInsert) {
                  await beforeInsert({});
                }

                return {
                  id: 1,
                  msisdn: '123',
                  role: 'RIDER',
                };
              }),
            findRiderByPhone: jest.fn().mockResolvedValue([]),
          },
        },
        {
          provide: DriverProfileRepository,
          useValue: {
            createDriverProfileWithLock: jest
              .fn()
              .mockImplementation(
                async (
                  _msisdn,
                  _driverLicense,
                  _vehicleLicense,
                  _name,
                  beforeInsert,
                ) => {
                  if (beforeInsert) {
                    await beforeInsert({});
                  }

                  return {
                    id: 1,
                    msisdn: '123',
                    role: 'DRIVER',
                  };
                },
              ),
            findDriverByPhone: jest.fn().mockResolvedValue([]),
          },
        },
        {
          provide: DataEncryptionService,
          useValue: {
            encrypt: jest.fn((value) => value),
          },
        },
      ],
    }).compile();

    service = module.get<ClientService>(ClientService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
