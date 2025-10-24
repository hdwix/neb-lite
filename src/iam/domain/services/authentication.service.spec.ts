import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { Cache } from 'cache-manager';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AuthenticationService } from './authentication.service';
import { NebengjekClientRepository } from '../../infrastructure/repository/nebengjek-client.repository';
import { HashingService } from './hashing.service';
import { SmsProviderService } from './sms-processor';

describe('AuthenticationService', () => {
  const nebengjekClientRepo = {
    upsertUserByPhone: jest.fn(),
    findUserByPhone: jest.fn(),
    findUserbyId: jest.fn(),
  } as unknown as NebengjekClientRepository;

  const hashingService = {
    hash: jest.fn(),
    compare: jest.fn(),
  } as unknown as HashingService;

  const configService = {
    get: jest.fn(),
  } as unknown as ConfigService;

  const cacheManager = {
    set: jest.fn(),
    get: jest.fn(),
    del: jest.fn(),
  } as unknown as Cache;

  const jwtService = {
    signAsync: jest.fn(),
    verifyAsync: jest.fn(),
  } as unknown as JwtService;

  const smsProviderService = {
    sendOtp: jest.fn(),
  } as unknown as SmsProviderService;

  const jwtConfiguration = {
    secret: 'secret',
    accessTokenTtl: 1,
    refreshTokenTtl: 2,
  } as const;

  let service: AuthenticationService;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2024-01-01T00:00:00Z'));
    jest.resetAllMocks();
    service = new AuthenticationService(
      nebengjekClientRepo,
      hashingService,
      configService,
      cacheManager,
      jwtService,
      jwtConfiguration,
      smsProviderService,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('generates otp, caches it and sends sms', async () => {
    const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0);
    jest.spyOn(configService, 'get').mockReturnValue(120);
    jest.spyOn(hashingService, 'hash').mockResolvedValue('hashed');

    const result = await service.getOtp({ phone: '+6281112345678' });

    expect(result).toBe('100000');
    expect(nebengjekClientRepo.upsertUserByPhone).toHaveBeenCalledWith(
      '+6281112345678',
    );
    expect(cacheManager.set).toHaveBeenCalledWith(
      'otp:+6281112345678',
      'hashed',
      120,
    );
    expect(smsProviderService.sendOtp).toHaveBeenCalledWith(
      '+6281112345678',
      '100000',
    );
    randomSpy.mockRestore();
  });

  it('throws unauthorized when client does not exist', async () => {
    jest.spyOn(nebengjekClientRepo, 'findUserByPhone').mockResolvedValue(null);

    await expect(
      service.verifyOtp({ phone: '+6281112345678', otpCode: '123456' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('throws unauthorized when cached otp is missing', async () => {
    jest
      .spyOn(nebengjekClientRepo, 'findUserByPhone')
      .mockResolvedValue([
        { id: 1, role: 'CUSTOMER', phone_number: '+6281112345678' },
      ]);
    jest.spyOn(cacheManager, 'get').mockResolvedValue(undefined);

    await expect(
      service.verifyOtp({ phone: '+6281112345678', otpCode: '123456' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('throws unauthorized when otp does not match', async () => {
    jest
      .spyOn(nebengjekClientRepo, 'findUserByPhone')
      .mockResolvedValue([
        { id: 1, role: 'CUSTOMER', phone_number: '+6281112345678' },
      ]);
    jest.spyOn(cacheManager, 'get').mockResolvedValue('hashed');
    jest.spyOn(hashingService, 'compare').mockResolvedValue(false);

    await expect(
      service.verifyOtp({ phone: '+6281112345678', otpCode: '000000' }),
    ).rejects.toThrow('OTP code does not match');
  });

  it('returns tokens and clears cache when otp is valid', async () => {
    jest
      .spyOn(nebengjekClientRepo, 'findUserByPhone')
      .mockResolvedValue([
        { id: 1, role: 'CUSTOMER', phone_number: '+6281112345678' },
      ]);
    jest.spyOn(cacheManager, 'get').mockResolvedValue('hashed');
    jest.spyOn(hashingService, 'compare').mockResolvedValue(true);
    jest
      .spyOn(service, 'generateTokens')
      .mockResolvedValue({ accessToken: 'a', refreshToken: 'r' });

    const tokens = await service.verifyOtp({
      phone: '+6281112345678',
      otpCode: '123456',
    });

    expect(tokens).toEqual({ accessToken: 'a', refreshToken: 'r' });
    expect(cacheManager.del).toHaveBeenCalledWith('otp:+6281112345678');
  });

  it('generates and caches access and refresh tokens', async () => {
    jest.spyOn(jwtService, 'signAsync').mockResolvedValueOnce('access');
    jest.spyOn(jwtService, 'signAsync').mockResolvedValueOnce('refresh');

    const result = await service.generateTokens({
      id: 1,
      role: 'CUSTOMER',
      phone_number: '+6281112345678',
    });

    expect(jwtService.signAsync).toHaveBeenNthCalledWith(
      1,
      {
        sub: 1,
        accessTokenId: expect.any(String),
        role: 'CUSTOMER',
        phone_number: '+6281112345678',
      },
      {
        secret: 'secret',
        expiresIn: 1,
      },
    );
    expect(jwtService.signAsync).toHaveBeenNthCalledWith(
      2,
      {
        sub: 1,
        refreshTokenId: expect.any(String),
        role: 'CUSTOMER',
        phone_number: '+6281112345678',
      },
      {
        secret: 'secret',
        expiresIn: 2,
      },
    );
    expect(result).toEqual({ accessToken: 'access', refreshToken: 'refresh' });
    expect(cacheManager.set).toHaveBeenNthCalledWith(
      1,
      'refresh-token:+6281112345678',
      expect.any(String),
      2,
    );
    expect(cacheManager.set).toHaveBeenNthCalledWith(
      2,
      'access-token:+6281112345678',
      expect.any(String),
      1000,
    );
  });

  it('refreshes token when validateRefreshToken returns true', async () => {
    const spyGetClient = jest
      .spyOn(service, 'getClientAndTokenIdInfo')
      .mockResolvedValue({
        client: [{ id: 1, role: 'CUSTOMER', phone_number: '+6281112345678' }],
        refreshTokenId: 'id',
      });
    jest.spyOn(service as any, 'validateRefreshToken').mockResolvedValue(true);
    jest
      .spyOn(service, 'generateTokens')
      .mockResolvedValue({ accessToken: 'a', refreshToken: 'r' });

    const result = await service.getRefreshToken({ refreshToken: 'token' });

    expect(result).toEqual({ accessToken: 'a', refreshToken: 'r' });
    expect(spyGetClient).toHaveBeenCalled();
  });

  it('throws unauthorized when refresh token validation fails', async () => {
    jest
      .spyOn(service, 'getClientAndTokenIdInfo')
      .mockResolvedValue({
        client: [{ phone_number: '+6281112345678' }],
        refreshTokenId: 'id',
      });
    jest.spyOn(service as any, 'validateRefreshToken').mockResolvedValue(false);

    await expect(
      service.getRefreshToken({ refreshToken: 'token' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('throws unauthorized when refresh token verification throws', async () => {
    jest
      .spyOn(service, 'getClientAndTokenIdInfo')
      .mockRejectedValue(new Error('boom'));

    await expect(
      service.getRefreshToken({ refreshToken: 'token' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('logout clears access token when validation succeeds', async () => {
    jest.spyOn(service, 'getClientAndTokenIdInfo').mockResolvedValue({
      client: [{ id: 1, role: 'CUSTOMER', phone_number: '+6281112345678' }],
      refreshTokenId: 'id',
    });
    jest.spyOn(service as any, 'validateRefreshToken').mockResolvedValue(true);

    const result = await service.logout({ refreshToken: 'token' });

    expect(result).toBe('successfully logout');
    expect(cacheManager.del).toHaveBeenCalledWith(
      'access-token:+6281112345678',
    );
  });

  it('logout throws when refresh token invalid', async () => {
    jest
      .spyOn(service, 'getClientAndTokenIdInfo')
      .mockResolvedValue({
        client: [{ phone_number: '+6281112345678' }],
        refreshTokenId: 'id',
      });
    jest.spyOn(service as any, 'validateRefreshToken').mockResolvedValue(false);

    await expect(
      service.logout({ refreshToken: 'token' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('validateRefreshToken returns true when cached id matches', async () => {
    jest.spyOn(cacheManager, 'get').mockResolvedValue('id');

    const result = await (service as any).validateRefreshToken(
      [{ phone_number: '+6281112345678' }],
      'id',
    );

    expect(result).toBe(true);
    expect(cacheManager.del).toHaveBeenCalledWith(
      'refresh-token:+6281112345678',
    );
  });

  it('validateRefreshToken returns false when cached id does not match', async () => {
    jest.spyOn(cacheManager, 'get').mockResolvedValue('other');

    const result = await (service as any).validateRefreshToken(
      [{ phone_number: '+6281112345678' }],
      'id',
    );

    expect(result).toBe(false);
  });

  it('getClientAndTokenIdInfo verifies token and fetches client', async () => {
    jest.spyOn(jwtService, 'verifyAsync').mockResolvedValue({
      sub: 1,
      refreshTokenId: 'token-id',
    });
    jest.spyOn(nebengjekClientRepo, 'findUserbyId').mockResolvedValue('client');

    const result = await service.getClientAndTokenIdInfo({
      refreshToken: 'token',
    });

    expect(result).toEqual({ client: 'client', refreshTokenId: 'token-id' });
    expect(jwtService.verifyAsync).toHaveBeenCalledWith('token', {
      secret: 'secret',
    });
    expect(nebengjekClientRepo.findUserbyId).toHaveBeenCalledWith(1);
  });
});
