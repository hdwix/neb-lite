import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthenticationGuard } from './authentication.guard';
import { AccessTokenGuard } from '../access-token/access-token.guard';
import { EAuthType } from '../../../domain/constants/auth-type.enum';

describe('AuthenticationGuard', () => {
  const reflector = {
    getAllAndOverride: jest.fn(),
  } as unknown as Reflector;

  const accessTokenGuard = {
    canActivate: jest.fn(),
  } as unknown as AccessTokenGuard;

  const context = {
    switchToHttp: () => ({ getRequest: () => ({}) }),
    getHandler: jest.fn(),
    getClass: jest.fn(),
  } as unknown as ExecutionContext;

  let guard: AuthenticationGuard;

  beforeEach(() => {
    jest.resetAllMocks();
    guard = new AuthenticationGuard(reflector, accessTokenGuard);
  });

  it('defaults to bearer authentication when no metadata is provided', async () => {
    jest.spyOn(accessTokenGuard, 'canActivate').mockResolvedValue(true);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(accessTokenGuard.canActivate).toHaveBeenCalledWith(context);
  });

  it('allows routes annotated with AuthType None', async () => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValue([EAuthType.None]);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(accessTokenGuard.canActivate).not.toHaveBeenCalled();
  });

  it('throws last encountered error when guards fail', async () => {
    const error = new UnauthorizedException('failed');
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([
      EAuthType.Bearer,
    ]);
    jest.spyOn(accessTokenGuard, 'canActivate').mockRejectedValue(error);

    await expect(guard.canActivate(context)).rejects.toBe(error);
  });
});
