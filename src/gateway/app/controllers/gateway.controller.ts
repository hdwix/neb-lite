import {
  Body,
  Controller,
  ForbiddenException,
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
import { MsisdnParamDto } from '../../../app/dto/msisdn-param.dto';
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
import { DriverRespondRideDto } from '../../../rides/app/dto/driver-respond-ride.dto';
import { StartRideDto } from '../../../rides/app/dto/start-ride.dto';
import { TripLocationUpdateDto } from '../../../rides/app/dto/trip-location-update.dto';
import { CompleteRideDto } from '../../../rides/app/dto/complete-ride.dto';
import { ApplyDiscountDto } from '../../../rides/app/dto/apply-discount.dto';
import { CompletePaymentDto } from '../../../rides/app/dto/complete-payment.dto';
import { toParticipantLocation } from '../../../rides/app/dto/trip-location.dto';
import { Ride } from '../../../rides/domain/entities/ride.entity';
import {
  NotificationStreamService,
  NotificationTarget,
  OTP_SIMULATION_TARGET,
} from '../../../notifications/domain/services/notification-stream.service';
import { Observable } from 'rxjs';
import { ConfigService } from '@nestjs/config';
import { ClientService } from '../../../client/domain/services/client.service';
import { SignupRiderDto } from '../../../client/app/dto/signup-rider.dto';
import { SignupDriverDto } from '../../../client/app/dto/signup-driver.dto';

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
    private readonly configService: ConfigService,
    private readonly clientService: ClientService,
  ) {}

  /*
   * api for client-module
   */

  @Post('client/rider/signup')
  @Auth(EAuthType.None)
  @HttpCode(HttpStatus.CREATED)
  async signupRider(@Body() signupRiderDto: SignupRiderDto) {
    const rider = await this.clientService.signupRider(signupRiderDto);

    return {
      data: rider,
    };
  }

  @Post('client/driver/signup')
  @Auth(EAuthType.None)
  @HttpCode(HttpStatus.CREATED)
  async signupDriver(@Body() signupDriverDto: SignupDriverDto) {
    const driver = await this.clientService.signupDriver(signupDriverDto);

    return {
      data: driver,
    };
  }

  /*
   * api for iam-module
   */

  @HttpCode(HttpStatus.OK)
  @Auth(EAuthType.None)
  @Post('auth/request-otp')
  async getOtp(@Body() getOtpDto: GetOtpDto) {
    return await this.authService.getOtp(getOtpDto);
  }

  @Sse('auth/simulate/:msisdn/get-otp')
  @Auth(EAuthType.None)
  simulateGetOtp(
    @Param() params: MsisdnParamDto,
    @Req() request: Request,
  ): Observable<MessageEvent> {
    const trustedClientToken = this.configService.get<string>(
      'OTP_SIMULATION_ACCESS_TOKEN',
    );

    if (!trustedClientToken) {
      throw new ForbiddenException('OTP simulation stream is disabled.');
    }

    const providedToken = request.header('x-otp-simulation-token');

    if (providedToken !== trustedClientToken) {
      throw new UnauthorizedException('Invalid OTP simulation token.');
    }

    return this.notificationStreamService.subscribe(
      OTP_SIMULATION_TARGET,
      params.msisdn,
    );
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
      throw new UnauthorizedException(
        'Unsupported client type for notifications',
      );
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
  async completeRide(
    @Req() request: Request,
    @Param('id') rideId: string,
    @Body() completeRideDto: CompleteRideDto,
  ) {
    const client = this.getAuthenticatedClient(request);
    const ride = await this.ridesService.completeRide(
      rideId,
      {
        id: this.getClientId(client),
        role: client.role,
      },
      toParticipantLocation(completeRideDto.driverLocation),
    );

    return {
      statusCode: HttpStatus.OK,
      message: 'Ride completed',
      error: null,
      data: this.toRideResponse(ride),
    };
  }

  @Post('rides/:id/start')
  @Auth(EAuthType.Bearer)
  @Roles(EClientType.DRIVER)
  @HttpCode(HttpStatus.OK)
  async startRide(
    @Req() request: Request,
    @Param('id') rideId: string,
    @Body() startRideDto: StartRideDto,
  ) {
    console.log('from controller: ride start');
    const client = this.getAuthenticatedClient(request);
    const ride = await this.ridesService.startRide(
      rideId,
      this.getClientId(client),
      toParticipantLocation(startRideDto.driverLocation),
    );

    return {
      statusCode: HttpStatus.OK,
      message: 'Ride started',
      error: null,
      data: this.toRideResponse(ride),
    };
  }

  @Post('rides/:id/tracking')
  @Auth(EAuthType.Bearer)
  @Roles(EClientType.DRIVER, EClientType.RIDER)
  @HttpCode(HttpStatus.ACCEPTED)
  async recordTripLocation(
    @Req() request: Request,
    @Param('id') rideId: string,
    @Body() updateDto: TripLocationUpdateDto,
  ) {
    const client = this.getAuthenticatedClient(request);
    await this.ridesService.recordTripLocation(
      rideId,
      {
        id: this.getClientId(client),
        role: client.role,
      },
      toParticipantLocation(updateDto.location),
    );

    return {
      statusCode: HttpStatus.ACCEPTED,
      message: 'Location recorded',
      error: null,
      data: {},
    };
  }

  @Post('rides/:id/discount')
  @Auth(EAuthType.Bearer)
  @Roles(EClientType.DRIVER)
  @HttpCode(HttpStatus.OK)
  async applyRideDiscount(
    @Req() request: Request,
    @Param('id') rideId: string,
    @Body() applyDiscountDto: ApplyDiscountDto,
  ) {
    const client = this.getAuthenticatedClient(request);
    const ride = await this.ridesService.applyRideDiscount(
      rideId,
      this.getClientId(client),
      applyDiscountDto,
    );

    return {
      statusCode: HttpStatus.OK,
      message: 'Discount applied',
      error: null,
      data: this.toRideResponse(ride),
    };
  }

  @Post('rides/:id/payment/complete')
  @Auth(EAuthType.Bearer)
  @Roles(EClientType.RIDER)
  @HttpCode(HttpStatus.OK)
  async completeRidePayment(
    @Req() request: Request,
    @Param('id') rideId: string,
    @Body() completePaymentDto: CompletePaymentDto,
  ) {
    const client = this.getAuthenticatedClient(request);
    const ride = await this.ridesService.confirmRidePayment(
      rideId,
      this.getClientId(client),
      completePaymentDto,
    );

    return {
      statusCode: HttpStatus.OK,
      message: 'Payment confirmed',
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

  @Post('rides/:id/driver-reject')
  @Auth(EAuthType.Bearer)
  @Roles(EClientType.DRIVER)
  @HttpCode(HttpStatus.OK)
  async rejectRideAsDriver(
    @Req() request: Request,
    @Param('id') rideId: string,
    @Body() respondDto: DriverRespondRideDto,
  ) {
    const client = this.getAuthenticatedClient(request);
    const ride = await this.ridesService.rejectRideByDriver(
      rideId,
      this.getClientId(client),
      respondDto?.reason,
    );

    return {
      statusCode: HttpStatus.OK,
      message: 'Ride rejected by driver',
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
      distanceActualKm: ride.distanceActualKm ?? null,
      discountPercent: ride.discountPercent ?? null,
      discountAmount: ride.discountAmount ?? null,
      appFeeAmount: ride.appFeeAmount ?? null,
      paymentUrl: ride.paymentUrl ?? null,
      paymentStatus: ride.paymentStatus ?? null,
      createdAt: ride.createdAt?.toISOString?.() ?? ride.createdAt,
      candidates: (ride.candidates ?? []).map((candidate) => ({
        driverId: candidate.driverId,
        status: candidate.status,
        reason: candidate.reason ?? null,
        distanceMeters: candidate.distanceMeters ?? null,
        respondedAt:
          candidate.respondedAt?.toISOString?.() ??
          candidate.respondedAt ??
          null,
        createdAt:
          candidate.createdAt?.toISOString?.() ?? candidate.createdAt ?? null,
      })),
    };
  }
}
