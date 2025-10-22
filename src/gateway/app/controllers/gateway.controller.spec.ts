import { Test, TestingModule } from '@nestjs/testing';
import { GatewayController } from './gateway.controller';
import { AuthenticationService } from '../../../iam/domain/services/authentication.service';
import { LocationService } from '../../../location/domain/services/location.service';
import { REQUEST_CLIENT_KEY } from '../../../app/constants/request-client-key';
import { UnauthorizedException } from '@nestjs/common';
import { RidesService } from '../../../rides/domain/services/rides.service';
import { NotificationStreamService } from '../../../notifications/domain/services/notification-stream.service';
import { EClientType } from '../../../app/enums/client-type.enum';
import { of } from 'rxjs';

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
    Pick<NotificationStreamService, 'subscribe'>
  >;

  beforeEach(async () => {
    jest.clearAllMocks();

    const ridesServiceMock: jest.Mocked<
      Pick<
        RidesService,
        | 'createRide'
        | 'getRideById'
        | 'cancelRide'
        | 'completeRide'
        | 'acceptRideByDriver'
        | 'confirmDriverAcceptance'
        | 'rejectDriverAcceptance'
      >
    > = {
      createRide: jest.fn(),
      getRideById: jest.fn(),
      cancelRide: jest.fn(),
      completeRide: jest.fn(),
      acceptRideByDriver: jest.fn(),
      confirmDriverAcceptance: jest.fn(),
      rejectDriverAcceptance: jest.fn(),
    };

    notificationStreamServiceMock = {
      subscribe: jest.fn(),
    } as jest.Mocked<Pick<NotificationStreamService, 'subscribe'>>;

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
          provide: RidesService,
          useValue: ridesServiceMock as unknown as RidesService,
        },
        {
          provide: NotificationStreamService,
          useValue: notificationStreamServiceMock as unknown as NotificationStreamService,
        },
      ],
    }).compile();

    controller = module.get<GatewayController>(GatewayController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
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
