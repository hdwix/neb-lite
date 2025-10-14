import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Cache } from 'cache-manager';
import { AccessTokenGuard } from './access-token.guard';
import { REQUEST_CLIENT_KEY } from '../../../../app/constants/request-client-key';

describe('AccessTokenGuard', () => {
  const createExecutionContext = (request: any): ExecutionContext => {
    return {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    } as unknown as ExecutionContext;
  };

  const jwtService = {
    verifyAsync: jest.fn(),
  } as unknown as JwtService;

  const cacheManager = {
    get: jest.fn(),
    set: jest.fn(),
  } as unknown as Cache;

  const jwtConfiguration = {
    secret: 'secret',
  } as any;

  let guard: AccessTokenGuard;

  beforeEach(() => {
    jest.resetAllMocks();
    guard = new AccessTokenGuard(jwtService, jwtConfiguration, cacheManager);
  });

  it('grants access when x-sign header is xtest', async () => {
    const request = { headers: { 'x-sign': 'xtest' } } as any;
    const context = createExecutionContext(request);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(jwtService.verifyAsync).not.toHaveBeenCalled();
  });

  it('throws when authorization header is missing', async () => {
    const request = { headers: {} } as any;
    const context = createExecutionContext(request);

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('throws when jwt verification fails', async () => {
    const request = {
      headers: { authorization: 'Bearer token' },
    } as any;
    const context = createExecutionContext(request);

    jest.spyOn(jwtService, 'verifyAsync').mockRejectedValue(new Error('fail'));

    await expect(guard.canActivate(context)).rejects.toThrow(
      new UnauthorizedException('Authorization failed'),
    );
  });

  it('throws when cached access token does not match payload', async () => {
    const request: any = {
      headers: { authorization: 'Bearer token' },
    };
    const context = createExecutionContext(request);
    jest.spyOn(jwtService, 'verifyAsync').mockResolvedValue({
      phone_number: '123',
      accessTokenId: 'payload',
    });
    jest.spyOn(cacheManager, 'get').mockResolvedValue('cached');

    await expect(guard.canActivate(context)).rejects.toThrow(
      new UnauthorizedException('Authorization failed'),
    );
  });

  it('attaches payload to request when token is valid', async () => {
    const request: any = {
      headers: { authorization: 'Bearer token' },
    };
    const context = createExecutionContext(request);
    const payload = {
      phone_number: '123',
      accessTokenId: 'id',
    };
    jest.spyOn(jwtService, 'verifyAsync').mockResolvedValue(payload);
    jest.spyOn(cacheManager, 'get').mockResolvedValue('id');

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request[REQUEST_CLIENT_KEY]).toEqual(payload);
    expect(cacheManager.get).toHaveBeenCalledWith('access-token:123');
  });
});
