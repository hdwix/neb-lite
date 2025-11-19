import { SetMetadata } from '@nestjs/common';
import { EAuthType } from '../../domain/constants/auth-type.enum';

export const AUTH_TYPE_KEY = 'authType';

export const Auth = (...authTypes: EAuthType[]) =>
  SetMetadata(AUTH_TYPE_KEY, authTypes);
