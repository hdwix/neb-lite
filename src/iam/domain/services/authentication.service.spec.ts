import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import jwtConfig from '../../app/config/jwt.config';
import { NebengjekClientRepository } from '../../infrastructure/repository/nebengjek-client.repository';
import { HashingService } from './hashing.service';
import { AuthenticationService } from './authentication.service';
import { SmsProviderService } from './sms-provider.service';

describe('AuthenticationService', () => {
  let service: AuthenticationService;

  beforeEach(async () => {
    const mockConfigService = {
      get: jest.fn(),
    };
    const mockCacheManager = {
      set: jest.fn(),
      get: jest.fn(),
      del: jest.fn(),
    };
    const mockHashingService = {
      hash: jest.fn(),
      compare: jest.fn(),
    };
    const mockRepository = {
      upsertUserByPhone: jest.fn(),
      findUserByPhone: jest.fn(),
      findUserbyId: jest.fn(),
    };
    const mockJwtService = {
      signAsync: jest.fn(),
      verifyAsync: jest.fn(),
    };
    const mockSmsProviderService = {
      sendOtp: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthenticationService,
        { provide: NebengjekClientRepository, useValue: mockRepository },
        { provide: HashingService, useValue: mockHashingService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: CACHE_MANAGER, useValue: mockCacheManager },
        { provide: JwtService, useValue: mockJwtService },
        {
          provide: jwtConfig.KEY,
          useValue: {
            secret: 'test-secret',
            accessTokenTtl: 60,
            refreshTokenTtl: 120,
          },
        },
        { provide: SmsProviderService, useValue: mockSmsProviderService },
      ],
    }).compile();

    service = module.get<AuthenticationService>(AuthenticationService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
