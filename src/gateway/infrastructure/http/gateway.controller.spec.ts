import { Test, TestingModule } from '@nestjs/testing';
import { GatewayController } from './gateway.controller';
import { AuthenticationService } from '../../../iam/domain/services/authentication.service';
import { LocationService } from '../../../location/domain/services/location.service';
import { REQUEST_CLIENT_KEY } from '../../../app/constants/request-client-key';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { RidesManagementService } from '../../../rides/domain/services/rides-management.service';
import { RidesTrackingService } from '../../../rides/domain/services/rides-tracking.service';
import { RidesPaymentService } from '../../../rides/domain/services/rides-payment.service';
import { OTP_SIMULATION_TARGET } from '../../../notifications/domain/ports/notification-publisher.port';
import { EClientType } from '../../../app/enums/client-type.enum';
import { of } from 'rxjs';
import { ConfigService } from '@nestjs/config';
import { NotificationStreamAdapter } from '../../../notifications/infrastructure/adapters/notification-stream.adapter';
import { ClientService } from '../../../client/domain/services/client.service';

describe('GatewayController', () => {
  let controller: GatewayController;
  type AuthServiceMock = jest.Mocked<
    Pick<
      AuthenticationService,
      'getOtp' | 'verifyOtp' | 'getRefreshToken' | 'logout'
    >
  >;
  const authServiceMock = {
    getOtp: jest.fn(),
    verifyOtp: jest.fn(),
    getRefreshToken: jest.fn(),
    logout: jest.fn(),
  } as AuthServiceMock;

  type LocationServiceMock = jest.Mocked<
    Pick<LocationService, 'upsertDriverLocation' | 'getNearbyDrivers'>
  >;
  const locationServiceMock = {
    upsertDriverLocation: jest.fn(),
    getNearbyDrivers: jest.fn(),
  } as LocationServiceMock;
  let notificationStreamServiceMock: jest.Mocked<
    Pick<NotificationStreamAdapter, 'subscribe'>
  >;
  const configServiceMock = {
    get: jest.fn(),
  } as jest.Mocked<Pick<ConfigService, 'get'>>;
  type ClientServiceMock = jest.Mocked<
    Pick<ClientService, 'signupDriver' | 'signupRider'>
  >;
  const clientServiceMock = {
    signupDriver: jest.fn(),
    signupRider: jest.fn(),
  } as ClientServiceMock;

  beforeEach(async () => {
    jest.clearAllMocks();
    configServiceMock.get.mockReset();

      const ridesManagementServiceMock: Record<string, jest.Mock> = {
        createRide: jest.fn(),
        getRideById: jest.fn(),
        cancelRide: jest.fn(),
        acceptRideByDriver: jest.fn(),
        rejectRideByDriver: jest.fn(),
        confirmDriverAcceptance: jest.fn(),
        rejectDriverAcceptance: jest.fn(),
      };
      const ridesTrackingServiceMock: Record<string, jest.Mock> = {
        startRide: jest.fn(),
        recordTripLocation: jest.fn(),
        completeRide: jest.fn(),
      };
      const ridesPaymentServiceMock: Record<string, jest.Mock> = {
        proceedRidePayment: jest.fn(),
        handlePaymentNotification: jest.fn(),
      };

    notificationStreamServiceMock = {
      subscribe: jest.fn(),
    } as jest.Mocked<Pick<NotificationStreamAdapter, 'subscribe'>>;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [GatewayController],
      providers: [
        {
          provide: AuthenticationService,
          useValue: authServiceMock as unknown as AuthenticationService,
        },
        {
          provide: LocationService,
          useValue: locationServiceMock as unknown as LocationService,
        },
        {
          provide: RidesManagementService,
          useValue:
            ridesManagementServiceMock as unknown as RidesManagementService,
        },
        {
          provide: RidesTrackingService,
          useValue: ridesTrackingServiceMock as unknown as RidesTrackingService,
        },
        {
          provide: RidesPaymentService,
          useValue: ridesPaymentServiceMock as unknown as RidesPaymentService,
        },
        {
          provide: NotificationStreamAdapter,
          useValue: notificationStreamServiceMock as unknown as NotificationStreamAdapter,
        },
        {
          provide: ConfigService,
          useValue: configServiceMock,
        },
        {
          provide: ClientService,
          useValue: clientServiceMock as unknown as ClientService,
        },
      ],
    }).compile();

    controller = module.get<GatewayController>(GatewayController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('simulateGetOtp', () => {
    it('subscribes to the otp simulation stream for the provided msisdn when trusted token provided', () => {
      const stream = of();
      notificationStreamServiceMock.subscribe.mockReturnValue(stream);
      configServiceMock.get.mockReturnValue('trusted-token');

      const result = controller.simulateGetOtp(
        {
          msisdn: '+6281234567890',
        } as any,
        {
          header: jest.fn().mockReturnValue('trusted-token'),
        } as any,
      );

      expect(notificationStreamServiceMock.subscribe).toHaveBeenCalledWith(
        OTP_SIMULATION_TARGET,
        '+6281234567890',
      );
      expect(result).toBe(stream);
    });

    it('throws when token is missing or invalid', () => {
      configServiceMock.get.mockReturnValue('expected-token');

      expect(() =>
        controller.simulateGetOtp(
          {
            msisdn: '+628111111111',
          } as any,
          {
            header: jest.fn().mockReturnValue('wrong-token'),
          } as any,
        ),
      ).toThrow(UnauthorizedException);
    });

    it('throws when simulation token is not configured', () => {
      configServiceMock.get.mockReturnValue(undefined as any);

      expect(() =>
        controller.simulateGetOtp(
          {
            msisdn: '+628111111111',
          } as any,
          {
            header: jest.fn().mockReturnValue('any'),
          } as any,
        ),
      ).toThrow(ForbiddenException);
    });
  });

  describe('upsertDriverLocation', () => {
    it('should call location service with authenticated driver id', async () => {
      const request = {
        [REQUEST_CLIENT_KEY]: {
          sub: 'driver-123',
        },
      } as any;

      const dto = {
        longitude: 10,
        latitude: -6,
        accuracyMeters: 5,
      };

      const response = await controller.upsertDriverLocation(request, dto);

      expect(locationServiceMock.upsertDriverLocation).toHaveBeenCalledWith(
        'driver-123',
        dto,
      );
      expect(response).toEqual({
        data: {},
        messageResponse: 'processing update location',
      });
    });

    it('should throw UnauthorizedException when driver id missing', async () => {
      const request = {
        [REQUEST_CLIENT_KEY]: {},
      } as any;

      await expect(
        controller.upsertDriverLocation(request, {
          longitude: 1,
          latitude: 2,
        }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  describe('getNearbyDrivers', () => {
    it('should forward parameters to location service and wrap result', async () => {
      const items = [
        { driverId: '1', distanceMeters: 100 },
        { driverId: '2', distanceMeters: 200 },
      ];
      locationServiceMock.getNearbyDrivers.mockResolvedValue(items);

      const result = await controller.getNearbyDrivers({
        longitude: 106.8,
        latitude: -6.1,
        limit: 5,
      });

      expect(locationServiceMock.getNearbyDrivers).toHaveBeenCalledWith(
        106.8,
        -6.1,
        5,
      );
      expect(result).toEqual({ data: { items } });
    });
  });

  describe('streamNotifications', () => {
    it('should subscribe driver clients to SSE notifications', () => {
      const observable = of();
      notificationStreamServiceMock.subscribe.mockReturnValue(observable);

      const request = {
        [REQUEST_CLIENT_KEY]: {
          sub: 'driver-42',
          role: EClientType.DRIVER,
        },
      } as any;

      const result = controller.streamNotifications(request);

      expect(notificationStreamServiceMock.subscribe).toHaveBeenCalledWith(
        'driver',
        'driver-42',
      );
      expect(result).toBe(observable);
    });

    it('should throw unauthorized when role is missing', () => {
      const request = {
        [REQUEST_CLIENT_KEY]: {
          sub: 'driver-99',
        },
      } as any;

      expect(() => controller.streamNotifications(request)).toThrow(UnauthorizedException);
    });
  });
});
