import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { EClientType } from '../../../../app/enums/client-type.enum';
import { ROLES_KEY } from '../../decorators/role.decorator';
import { REQUEST_CLIENT_KEY } from '../../../../app/constants/request-client-key';

@Injectable()
export class AccessRoleGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}
  canActivate(
    context: ExecutionContext,
  ): boolean | Promise<boolean> | Observable<boolean> {
    const contextRoles = this.reflector.getAllAndOverride<EClientType[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!contextRoles) {
      return true;
    }
    const req = context.switchToHttp().getRequest();
    const client = req[REQUEST_CLIENT_KEY];
    return contextRoles.some((role) => client.role === role);
  }
}
