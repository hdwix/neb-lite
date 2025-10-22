import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  MessageEvent,
  Param,
  Post,
  Query,
  Req,
  Res,
  Sse,
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
import { RidesService } from '../../../rides/domain/services/rides.service';
import { CreateRideDto } from '../../../rides/app/dto/create-ride.dto';
import { CancelRideDto } from '../../../rides/app/dto/cancel-ride.dto';
import { Ride } from '../../../rides/domain/entities/ride.entity';
import {
  NotificationStreamService,
  NotificationTarget,
} from '../../../notifications/domain/services/notification-stream.service';
import { Observable } from 'rxjs';

interface AuthenticatedClientPayload {
  sub?: string | number;
  role?: EClientType;
  msisdn?: string;
}

@Controller({ path: 'gateway', version: '1' })
export class GatewayController {
  constructor(
    private readonly authService: AuthenticationService,
    private readonly locationService: LocationService,
    private readonly ridesService: RidesService,
    private readonly notificationStreamService: NotificationStreamService,
  ) {}

  /*
   * api for iam-module
   */

  @HttpCode(HttpStatus.OK)
  @Auth(EAuthType.None)
  @Post('auth/request-otp')
  async getOtp(@Body() getOtpDto: GetOtpDto) {
    return await this.authService.getOtp(getOtpDto);
  }

  @HttpCode(HttpStatus.OK)
  @Auth(EAuthType.None)
  @Post('auth/verify-otp')
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

  @Post('auth/refresh-token')
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

  @Post('auth/logout')
  @Auth(EAuthType.None)
  @HttpCode(HttpStatus.OK)
  async logout(@Body() refreshTokenDto: RefreshTokenDto) {
    return await this.authService.logout(refreshTokenDto);
  }

  /*
   * api for location-module
   */

  @Post('location/driver')
  @HttpCode(HttpStatus.OK)
  // @Auth(EAuthType.Bearer)
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
      messageResponse: 'processing update location',
    };
  }

  @Get('matching/nearby-drivers')
  // @Auth(EAuthType.Bearer)
  @Roles(EClientType.RIDER)
  @HttpCode(HttpStatus.OK)
  async getNearbyDrivers(@Query() nearbyDriversDto: GetNearbyDriversDto) {
    const items = await this.locationService.getNearbyDrivers(
      nearbyDriversDto.longitude,
      nearbyDriversDto.latitude,
      nearbyDriversDto.limit,
    );

    return {
      data: {
        items,
      },
    };
  }

  /*
   * api for rides-module
   */

  @Sse('notifications/stream')
  @Auth(EAuthType.Bearer)
  streamNotifications(@Req() request: Request): Observable<MessageEvent> {
    const client = this.getAuthenticatedClient(request);
    const clientId = this.getClientId(client);
    const role = client?.role;

    if (!role) {
      throw new UnauthorizedException('Client role not found in request');
    }

    if (role !== EClientType.DRIVER && role !== EClientType.RIDER) {
      throw new UnauthorizedException('Unsupported client type for notifications');
    }

    const target: NotificationTarget =
      role === EClientType.DRIVER ? 'driver' : 'rider';

    return this.notificationStreamService.subscribe(target, clientId);
  }

  @Post('rides')
  @Auth(EAuthType.Bearer)
  @Roles(EClientType.RIDER)
  @HttpCode(HttpStatus.CREATED)
  async createRide(
    @Req() request: Request,
    @Body() createRideDto: CreateRideDto,
  ) {
    const client = this.getAuthenticatedClient(request);
    const riderId = this.getClientId(client);

    const ride = await this.ridesService.createRide(riderId, createRideDto);

    return {
      statusCode: HttpStatus.CREATED,
      message: 'Ride requested',
      error: null,
      data: this.toRideResponse(ride),
    };
  }

  @Get('rides/:id')
  @Auth(EAuthType.Bearer)
  @HttpCode(HttpStatus.OK)
  async getRide(@Req() request: Request, @Param('id') rideId: string) {
    const client = this.getAuthenticatedClient(request);
    const ride = await this.ridesService.getRideById(rideId, {
      id: this.getClientId(client),
      role: client.role,
    });

    return {
      statusCode: HttpStatus.OK,
      message: 'Ride retrieved',
      error: null,
      data: this.toRideResponse(ride),
    };
  }

  @Post('rides/:id/cancel')
  @Auth(EAuthType.Bearer)
  @Roles(EClientType.RIDER)
  @HttpCode(HttpStatus.OK)
  async cancelRide(
    @Req() request: Request,
    @Param('id') rideId: string,
    @Body() cancelRideDto: CancelRideDto,
  ) {
    const client = this.getAuthenticatedClient(request);
    const ride = await this.ridesService.cancelRide(
      rideId,
      {
        id: this.getClientId(client),
        role: client.role,
      },
      cancelRideDto,
    );

    return {
      statusCode: HttpStatus.OK,
      message: 'Ride cancelled',
      error: null,
      data: this.toRideResponse(ride),
    };
  }

  @Post('rides/:id/complete')
  @Auth(EAuthType.Bearer)
  @Roles(EClientType.DRIVER)
  @HttpCode(HttpStatus.OK)
  async completeRide(@Req() request: Request, @Param('id') rideId: string) {
    const client = this.getAuthenticatedClient(request);
    const ride = await this.ridesService.completeRide(rideId, {
      id: this.getClientId(client),
      role: client.role,
    });

    return {
      statusCode: HttpStatus.OK,
      message: 'Ride completed',
      error: null,
      data: this.toRideResponse(ride),
    };
  }

  @Post('rides/:id/driver-accept')
  @Auth(EAuthType.Bearer)
  @Roles(EClientType.DRIVER)
  @HttpCode(HttpStatus.OK)
  async acceptRideAsDriver(
    @Req() request: Request,
    @Param('id') rideId: string,
  ) {
    const client = this.getAuthenticatedClient(request);
    const ride = await this.ridesService.acceptRideByDriver(
      rideId,
      this.getClientId(client),
    );

    return {
      statusCode: HttpStatus.OK,
      message: 'Ride accepted by driver',
      error: null,
      data: this.toRideResponse(ride),
    };
  }

  @Post('rides/:id/rider-accept')
  @Auth(EAuthType.Bearer)
  @Roles(EClientType.RIDER)
  @HttpCode(HttpStatus.OK)
  async confirmDriverAcceptance(
    @Req() request: Request,
    @Param('id') rideId: string,
  ) {
    const client = this.getAuthenticatedClient(request);
    const ride = await this.ridesService.confirmDriverAcceptance(
      rideId,
      this.getClientId(client),
    );

    return {
      statusCode: HttpStatus.OK,
      message: 'Ride confirmed by rider',
      error: null,
      data: this.toRideResponse(ride),
    };
  }

  @Post('rides/:id/rider-reject')
  @Auth(EAuthType.Bearer)
  @Roles(EClientType.RIDER)
  @HttpCode(HttpStatus.OK)
  async rejectDriverAcceptance(
    @Req() request: Request,
    @Param('id') rideId: string,
    @Body() cancelRideDto: CancelRideDto,
  ) {
    const client = this.getAuthenticatedClient(request);
    const ride = await this.ridesService.rejectDriverAcceptance(
      rideId,
      this.getClientId(client),
      cancelRideDto?.reason,
    );

    return {
      statusCode: HttpStatus.OK,
      message: 'Ride rejected by rider',
      error: null,
      data: this.toRideResponse(ride),
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

  private toRideResponse(ride: Ride) {
    return {
      id: ride.id,
      riderId: ride.riderId,
      driverId: ride.driverId,
      pickup: {
        longitude: ride.pickupLongitude,
        latitude: ride.pickupLatitude,
      },
      dropoff: {
        longitude: ride.dropoffLongitude,
        latitude: ride.dropoffLatitude,
      },
      status: ride.status,
      fareEstimated: ride.fareEstimated ?? null,
      fareFinal: ride.fareFinal ?? null,
      distanceEstimatedKm: ride.distanceEstimatedKm ?? null,
      durationEstimatedSeconds: ride.durationEstimatedSeconds ?? null,
      createdAt: ride.createdAt?.toISOString?.() ?? ride.createdAt,
    };
  }
}
