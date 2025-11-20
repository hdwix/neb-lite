import {
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import { Cache } from 'cache-manager';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AuthenticationService } from './authentication.service';
import { HashingService } from './hashing.service';
import { GetOtpDto } from '../../../app/dto/get-otp.dto';
import { VerifyOtpDto } from '../../../app/dto/verify-otp.dto';
import { RefreshTokenDto } from '../../../app/dto/refresh-token.dto';
import { RiderProfileRepository } from '../../infrastructure/repository/rider-profile.repository';
import { DriverProfileRepository } from '../../infrastructure/repository/driver-profile.repository';
import { EClientType } from '../../../app/enums/client-type.enum';
import { Queue } from 'bullmq';
import {
  NotificationPublisher,
  OTP_SIMULATION_TARGET,
} from '../../../notifications/domain/ports/notification-publisher.port';
import { ISendOtpQueueData } from '../../app/types/iam-module-types-definition';

describe('AuthenticationService', () => {
  let service: AuthenticationService;
  let hashingService: { hash: jest.Mock; compare: jest.Mock };
  let configService: { get: jest.Mock };
  let cacheManager: { set: jest.Mock; get: jest.Mock; del: jest.Mock };
  let jwtService: { signAsync: jest.Mock; verifyAsync: jest.Mock };
  let riderRepo: { findRiderbyId: jest.Mock };
  let driverRepo: { findDriverbyId: jest.Mock };
  let sendOtpQueue: { add: jest.Mock };
  let notificationPublisher: { emit: jest.Mock };

  const jwtConfiguration = {
    secret: 'secret',
    accessTokenTtl: 10,
    refreshTokenTtl: 20,
  };

  const riderClient = { id: '1', msisdn: '+6281112345678', role: EClientType.RIDER };

  beforeEach(() => {
    hashingService = {
      hash: jest.fn().mockResolvedValue('hashed'),
      compare: jest.fn(),
    };
    configService = {
      get: jest.fn((key: string) => {
        if (key === 'OTP_TTL_SEC') {
          return 60;
        }
        if (key === 'SKIP_SMS_NOTIF') {
          return true;
        }
        return undefined;
      }),
    };
    cacheManager = {
      set: jest.fn(),
      get: jest.fn(),
      del: jest.fn(),
    };
    jwtService = {
      signAsync: jest.fn(),
      verifyAsync: jest.fn(),
    };
    riderRepo = {
      findRiderbyId: jest.fn().mockResolvedValue([riderClient]),
    };
    driverRepo = {
      findDriverbyId: jest.fn(),
    };
    sendOtpQueue = {
      add: jest.fn(),
    };
    notificationPublisher = {
      emit: jest.fn().mockResolvedValue(true),
    };

    service = new AuthenticationService(
      hashingService as unknown as HashingService,
      configService as unknown as ConfigService,
      cacheManager as unknown as Cache,
      jwtService as unknown as JwtService,
      jwtConfiguration,
      riderRepo as unknown as RiderProfileRepository,
      driverRepo as unknown as DriverProfileRepository,
      sendOtpQueue as unknown as Queue<ISendOtpQueueData>,
      notificationPublisher as unknown as NotificationPublisher,
    );
  });

  it('hashes and caches OTP codes while emitting simulation events', async () => {
    const otpSpy = jest
      .spyOn<any, any>(service as any, 'generateOtp')
      .mockReturnValue('123456');
    const result = await service.getOtp({
      clientId: riderClient.id,
      clientType: EClientType.RIDER,
    } as GetOtpDto);

    expect(result).toBe('otp code sent');
    expect(hashingService.hash).toHaveBeenCalledWith('123456');
    expect(cacheManager.set).toHaveBeenCalledWith('otp:+6281112345678', 'hashed', 60);
    expect(notificationPublisher.emit).toHaveBeenCalledWith(
      OTP_SIMULATION_TARGET,
      riderClient.msisdn,
      'otp.generated',
      expect.objectContaining({ otp: '123456', clientType: EClientType.RIDER }),
    );
    expect(sendOtpQueue.add).not.toHaveBeenCalled();
    otpSpy.mockRestore();
  });

  it('throws when cached OTP is missing', async () => {
    jest.spyOn(cacheManager, 'get').mockResolvedValue(undefined);

    await expect(
      service.verifyOtp({
        clientId: riderClient.id,
        clientType: EClientType.RIDER,
        otpCode: '654321',
      } as VerifyOtpDto),
    ).rejects.toThrow(new UnauthorizedException('Otp code not found : 654321'));
  });

  it('verifies OTP and returns generated tokens', async () => {
    jest.spyOn(cacheManager, 'get').mockResolvedValue('hashed');
    jest.spyOn(hashingService, 'compare').mockResolvedValue(true);
    const tokenSpy = jest
      .spyOn(service, 'generateTokens')
      .mockResolvedValue({ accessToken: 'access', refreshToken: 'refresh' });

    const result = await service.verifyOtp({
      clientId: riderClient.id,
      clientType: EClientType.RIDER,
      otpCode: '654321',
    } as VerifyOtpDto);

    expect(result).toEqual({ accessToken: 'access', refreshToken: 'refresh' });
    expect(cacheManager.del).toHaveBeenCalledWith('otp:+6281112345678');
    expect(tokenSpy).toHaveBeenCalledWith(riderClient);
  });

  it('generates and caches tokens with unique ids', async () => {
    jest
      .spyOn(jwtService, 'signAsync')
      .mockResolvedValueOnce('access-token')
      .mockResolvedValueOnce('refresh-token');

    const result = await service.generateTokens(riderClient);

    expect(jwtService.signAsync).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ sub: riderClient.id, role: riderClient.role }),
      { secret: jwtConfiguration.secret, expiresIn: jwtConfiguration.accessTokenTtl },
    );
    expect(jwtService.signAsync).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ sub: riderClient.id, role: riderClient.role }),
      { secret: jwtConfiguration.secret, expiresIn: jwtConfiguration.refreshTokenTtl },
    );
    expect(cacheManager.set).toHaveBeenNthCalledWith(
      1,
      `refresh-token:${riderClient.role}:${riderClient.id}`,
      expect.any(String),
      jwtConfiguration.refreshTokenTtl,
    );
    expect(cacheManager.set).toHaveBeenNthCalledWith(
      2,
      `access-token:${riderClient.role}:${riderClient.id}`,
      expect.any(String),
      jwtConfiguration.accessTokenTtl * 1000,
    );
    expect(result).toEqual({ accessToken: 'access-token', refreshToken: 'refresh-token' });
  });

  it('returns new tokens for valid refresh requests', async () => {
    jest.spyOn(jwtService, 'verifyAsync').mockResolvedValue({
      sub: riderClient.id,
      refreshTokenId: 'token-id',
      role: EClientType.RIDER,
    });
    jest.spyOn(cacheManager, 'get').mockResolvedValue('token-id');
    jest
      .spyOn(service, 'generateTokens')
      .mockResolvedValue({ accessToken: 'a', refreshToken: 'r' });

    const result = await service.getRefreshToken({ refreshToken: 'refresh' } as RefreshTokenDto);

    expect(result).toEqual({ accessToken: 'a', refreshToken: 'r' });
    expect(cacheManager.del).toHaveBeenCalledWith(
      `refresh-token:${riderClient.role}:${riderClient.id}`,
    );
  });

  it('throws unauthorized when refresh token validation fails', async () => {
    jest.spyOn(jwtService, 'verifyAsync').mockResolvedValue({
      sub: riderClient.id,
      refreshTokenId: 'token-id',
      role: EClientType.RIDER,
    });
    jest.spyOn(cacheManager, 'get').mockResolvedValue('different');

    await expect(
      service.getRefreshToken({ refreshToken: 'bad' } as RefreshTokenDto),
    ).rejects.toThrow(new UnauthorizedException('Unauthoried refreshtoken'));
  });

  it('logs out clients by deleting cached access tokens', async () => {
    jest
      .spyOn(service, 'getClientAndTokenIdInfo')
      .mockResolvedValue({ client: [riderClient], refreshTokenId: 'token-id' });
    jest
      .spyOn(service as any, 'validateRefreshToken')
      .mockResolvedValue(true);

    const result = await service.logout({ refreshToken: 'token' } as RefreshTokenDto);

    expect(result).toBe('successfully logout');
    expect(cacheManager.del).toHaveBeenCalledWith(
      service.getAccessTokenKey(riderClient.role, riderClient.id),
    );
  });

  it('throws BadRequestException when logout validation fails', async () => {
    jest
      .spyOn(service, 'getClientAndTokenIdInfo')
      .mockResolvedValue({ client: [riderClient], refreshTokenId: 'token-id' });
    jest
      .spyOn(service as any, 'validateRefreshToken')
      .mockResolvedValue(false);

    await expect(
      service.logout({ refreshToken: 'token' } as RefreshTokenDto),
    ).rejects.toThrow(new BadRequestException('error validating refresh token'));
  });
});
