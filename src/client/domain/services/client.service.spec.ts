import { Test, TestingModule } from '@nestjs/testing';
import { ClientService } from './client.service';
import { RiderProfileRepository } from '../../../iam/infrastructure/repository/rider-profile.repository';
import { DriverProfileRepository } from '../../../iam/infrastructure/repository/driver-profile.repository';
import { DataEncryptionService } from './data-encryption.service';
import { DataSource } from 'typeorm';

describe('ClientService', () => {
  let service: ClientService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClientService,
        {
          provide: RiderProfileRepository,
          useValue: {},
        },
        {
          provide: DriverProfileRepository,
          useValue: {},
        },
        {
          provide: DataEncryptionService,
          useValue: {
            encrypt: jest.fn((value) => value),
          },
        },
        {
          provide: DataSource,
          useValue: {
            transaction: jest.fn(async (work: any) =>
              work({ query: jest.fn() }),
            ),
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
