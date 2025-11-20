import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Cache } from 'cache-manager';
import { AccessTokenGuard } from './access-token.guard';
import { REQUEST_CLIENT_KEY } from '../../../../app/constants/request-client-key';
import { EClientType } from '../../../../app/enums/client-type.enum';
import { RiderProfileRepository } from '../../../infrastructure/repository/rider-profile.repository';
import { DriverProfileRepository } from '../../../infrastructure/repository/driver-profile.repository';

describe('AccessTokenGuard', () => {
  let guard: AccessTokenGuard;
  let jwtService: { verifyAsync: jest.Mock };
  let cacheManager: { get: jest.Mock };
  let riderRepo: { findRiderbyId: jest.Mock };
  let driverRepo: { findDriverbyId: jest.Mock };

  const jwtConfiguration = { secret: 'secret', expiresIn: 10 } as any;

  const createContext = (request: any): ExecutionContext =>
    ({
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext);

  beforeEach(() => {
    jwtService = { verifyAsync: jest.fn() };
    cacheManager = { get: jest.fn() };
    riderRepo = {
      findRiderbyId: jest.fn().mockResolvedValue([{ id: '1', msisdn: '+62' }]),
    };
    driverRepo = {
      findDriverbyId: jest.fn().mockResolvedValue([{ id: '2', msisdn: '+63' }]),
    };
    guard = new AccessTokenGuard(
      jwtService as unknown as JwtService,
      jwtConfiguration,
      cacheManager as unknown as Cache,
      riderRepo as unknown as RiderProfileRepository,
      driverRepo as unknown as DriverProfileRepository,
    );
  });

  it('throws UnauthorizedException when token is missing', async () => {
    const request = { headers: {} };
    const context = createContext(request);

    await expect(guard.canActivate(context)).rejects.toThrow(
      new UnauthorizedException('Authorization token not found'),
    );
  });

  it('throws UnauthorizedException when JWT verification fails', async () => {
    const request = { headers: { authorization: 'Bearer token' } };
    const context = createContext(request);
    jest.spyOn(jwtService, 'verifyAsync').mockRejectedValue(new Error('fail'));

    await expect(guard.canActivate(context)).rejects.toThrow(
      new UnauthorizedException('Authorization failed'),
    );
  });

  it('throws when cached access token differs from payload', async () => {
    const request = { headers: { authorization: 'Bearer token' } } as any;
    const context = createContext(request);
    jest.spyOn(jwtService, 'verifyAsync').mockResolvedValue({
      sub: '1',
      role: EClientType.RIDER,
      accessTokenId: 'payload',
    });
    jest.spyOn(cacheManager, 'get').mockResolvedValue('cached');

    await expect(guard.canActivate(context)).rejects.toThrow(
      new UnauthorizedException('Authorization failed'),
    );
  });

  it('attaches client information to the request when validation succeeds', async () => {
    const request = { headers: { authorization: 'Bearer token' } } as any;
    const context = createContext(request);
    jest.spyOn(jwtService, 'verifyAsync').mockResolvedValue({
      sub: '1',
      role: EClientType.RIDER,
      accessTokenId: 'token',
    });
    jest.spyOn(cacheManager, 'get').mockResolvedValue('token');

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(riderRepo.findRiderbyId).toHaveBeenCalledWith('1');
    expect(request[REQUEST_CLIENT_KEY]).toEqual({
      sub: '1',
      role: EClientType.RIDER,
      msisdn: '+62',
    });
    expect(cacheManager.get).toHaveBeenCalledWith('access-token:RIDER:1');
  });

  it('fetches driver profiles when payload role is DRIVER', async () => {
    const request = { headers: { authorization: 'Bearer token' } } as any;
    const context = createContext(request);
    jest.spyOn(jwtService, 'verifyAsync').mockResolvedValue({
      sub: 'driver-id',
      role: EClientType.DRIVER,
      accessTokenId: 'id',
    });
    jest.spyOn(cacheManager, 'get').mockResolvedValue('id');

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(driverRepo.findDriverbyId).toHaveBeenCalledWith('driver-id');
    expect(request[REQUEST_CLIENT_KEY]).toEqual({
      sub: 'driver-id',
      role: EClientType.DRIVER,
      msisdn: '+63',
    });
  });
});
