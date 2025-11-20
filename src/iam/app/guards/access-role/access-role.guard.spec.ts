import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AccessRoleGuard } from './access-role.guard';
import { EClientType } from '../../../../app/enums/client-type.enum';
import { REQUEST_CLIENT_KEY } from '../../../../app/constants/request-client-key';

describe('AccessRoleGuard', () => {
  const getExecutionContext = (clientRole: EClientType): ExecutionContext => {
    const request = { [REQUEST_CLIENT_KEY]: { role: clientRole } } as any;
    return {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
      getHandler: jest.fn(),
      getClass: jest.fn(),
    } as unknown as ExecutionContext;
  };

  it('allows access when no roles metadata is defined', () => {
    const reflector = { getAllAndOverride: jest.fn(() => undefined) } as unknown as Reflector;
    const guard = new AccessRoleGuard(reflector);

    expect(guard.canActivate(getExecutionContext(EClientType.RIDER))).toBe(true);
    expect(reflector.getAllAndOverride).toHaveBeenCalled();
  });

  it('returns true when client role matches one of the required roles', () => {
    const reflector = {
      getAllAndOverride: jest.fn(() => [EClientType.DRIVER, EClientType.RIDER]),
    } as unknown as Reflector;
    const guard = new AccessRoleGuard(reflector);

    expect(guard.canActivate(getExecutionContext(EClientType.RIDER))).toBe(true);
  });

  it('returns false when client role does not match required roles', () => {
    const reflector = {
      getAllAndOverride: jest.fn(() => [EClientType.DRIVER]),
    } as unknown as Reflector;
    const guard = new AccessRoleGuard(reflector);

    expect(guard.canActivate(getExecutionContext(EClientType.RIDER))).toBe(false);
  });
});
