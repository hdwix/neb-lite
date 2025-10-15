import { Controller, Get, UseGuards } from '@nestjs/common';
import { Auth } from '../../iam/app/decorators/auth.decorator';
import { EAuthType } from '../enums/auth-type.enum';
import { Roles } from '../../iam/app/decorators/role.decorator';
import { EClientType } from '../enums/client-type.enum';

@Controller('app')
export class AppController {
  @Get()
  async getHello() {
    return 'Hello from controller';
  }

  @Get('public')
  @Auth(EAuthType.None)
  async getPublicHello() {
    return 'Hello Public from controller';
  }

  @Get('customer-only')
  @Roles(EClientType.RIDER)
  async getCustomerHello() {
    return 'Hello Customer from controller';
  }

  @Get('driver-only')
  @Roles(EClientType.DRIVER)
  async getDriverHello() {
    return 'Hello Driver from controller';
  }
}
