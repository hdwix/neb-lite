import { SetMetadata } from '@nestjs/common';
import { EClientType } from '../../../app/enums/client-type.enum';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: EClientType[]) => SetMetadata(ROLES_KEY, roles);
