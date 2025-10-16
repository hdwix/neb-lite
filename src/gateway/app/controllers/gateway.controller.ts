import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { GetOtpDto } from '../../../app/dto/get-otp.dto';
import { RefreshTokenDto } from '../../../app/dto/refresh-token.dto';
import { VerifyOtpDto } from '../../../app/dto/verify-otp.dto';
import { EAuthType } from '../../../app/enums/auth-type.enum';
import { Auth } from '../../../iam/app/decorators/auth.decorator';
import { AuthenticationService } from '../../../iam/domain/services/authentication.service';
import { Request, Response } from 'express';
import { Roles } from '../../../iam/app/decorators/role.decorator';
import { EClientType } from '../../../app/enums/client-type.enum';
import { REQUEST_CLIENT_KEY } from '../../../app/constants/request-client-key';
import { UpsertDriverLocationDto } from '../../../location/app/dto/upsert-driver-location.dto';
import { LocationService } from '../../../location/domain/services/location.service';
import { GetNearbyDriversDto } from '../../../location/app/dto/get-nearby-drivers.dto';

interface AuthenticatedClientPayload {
  sub?: string | number;
  role?: EClientType;
  msisdn?: string;
}

@Controller({ path: '', version: '1' })
export class GatewayController {
  constructor(
    private readonly authService: AuthenticationService,
    private readonly locationService: LocationService,
  ) {}

  @HttpCode(HttpStatus.OK)
  @Auth(EAuthType.None)
  @Post('gateway/auth/request-otp')
  async getOtp(@Body() getOtpDto: GetOtpDto) {
    return await this.authService.getOtp(getOtpDto);
  }

  @HttpCode(HttpStatus.OK)
  @Auth(EAuthType.None)
  @Post('gateway/auth/verify-otp')
  async verifyOtp(
    @Body() verifyOtpDto: VerifyOtpDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const token = await this.authService.verifyOtp(verifyOtpDto);
    response.cookie('accesstoken', token.accessToken, {
      secure: true,
      httpOnly: true,
      sameSite: true,
    });
    response.cookie('refreshtoken', token.refreshToken, {
      secure: true,
      httpOnly: true,
      sameSite: true,
    });
  }

  @Post('gateway/auth/refresh-token')
  @Auth(EAuthType.None)
  @HttpCode(HttpStatus.OK)
  async getRefreshToken(
    @Body() refreshTokenDto: RefreshTokenDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const refreshToken =
      await this.authService.getRefreshToken(refreshTokenDto);
    response.cookie('accesstoken', refreshToken.accessToken, {
      secure: true,
      httpOnly: true,
      sameSite: true,
    });
    response.cookie('refreshtoken', refreshToken.refreshToken, {
      secure: true,
      httpOnly: true,
      sameSite: true,
    });
  }

  @Post('gateway/auth/logout')
  @Auth(EAuthType.None)
  @HttpCode(HttpStatus.OK)
  async logout(@Body() refreshTokenDto: RefreshTokenDto) {
    return await this.authService.logout(refreshTokenDto);
  }

  @Post('location/driver')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Auth(EAuthType.Bearer)
  @Roles(EClientType.DRIVER)
  async upsertDriverLocation(
    @Req() request: Request,
    @Body() upsertDriverLocationDto: UpsertDriverLocationDto,
  ) {
    const client = this.getAuthenticatedClient(request);
    const driverId = this.getClientId(client);

    await this.locationService.upsertDriverLocation(
      driverId,
      upsertDriverLocationDto,
    );

    return {
      data: {},
      messageResponse: 'Driver location updated',
    };
  }

  @Get('matching/nearby-drivers')
  @Auth(EAuthType.Bearer)
  @Roles(EClientType.RIDER)
  async getNearbyDrivers(@Query() nearbyDriversDto: GetNearbyDriversDto) {
    const items = await this.locationService.getNearbyDrivers(
      nearbyDriversDto.lon,
      nearbyDriversDto.lat,
      nearbyDriversDto.radiusMeters,
      nearbyDriversDto.limit,
    );

    return {
      data: {
        items,
      },
    };
  }

  private getAuthenticatedClient(request: Request): AuthenticatedClientPayload {
    return request[REQUEST_CLIENT_KEY] as AuthenticatedClientPayload;
  }

  private getClientId(client: AuthenticatedClientPayload): string {
    const id = client?.sub;
    if (id === undefined || id === null) {
      throw new UnauthorizedException('Client identifier not found in request');
    }
    return String(id);
  }
}
