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
            withSignupLock: jest
              .fn()
              .mockImplementation(async (_msisdn, _fallback, work) =>
                work({}),
              ),
            findRiderByPhone: jest.fn().mockResolvedValue([]),
            createRiderProfile: jest.fn(),
          },
        },
        {
          provide: DriverProfileRepository,
          useValue: {
            withSignupLock: jest
              .fn()
              .mockImplementation(async (_msisdn, _fallback, work) =>
                work({}),
              ),
            findDriverByPhone: jest.fn().mockResolvedValue([]),
            createDriverProfile: jest.fn(),
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
