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
import { NotificationStreamAdapter } from '../services/notification-stream.adapter';
import { ClientService } from '../../../client/domain/services/client.service';
import { ERideStatus } from '../../../rides/domain/constants/ride-status.enum';
import { RideResponseService } from '../../../rides/domain/services/ride-response.service';

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
  let rideResponseServiceMock: jest.Mocked<
    Pick<RideResponseService, 'toRideResponse'>
  >;

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
    rideResponseServiceMock = {
      toRideResponse: jest.fn((ride) => ({ id: ride.id })),
    } as jest.Mocked<Pick<RideResponseService, 'toRideResponse'>>;

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
          useValue:
            notificationStreamServiceMock as unknown as NotificationStreamAdapter,
        },
        {
          provide: ConfigService,
          useValue: configServiceMock,
        },
        {
          provide: ClientService,
          useValue: clientServiceMock as unknown as ClientService,
        },
        {
          provide: RideResponseService,
          useValue: rideResponseServiceMock,
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

      expect(() => controller.streamNotifications(request)).toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('streamNotifications (extra cases)', () => {
    it('subscribes rider clients to SSE notifications', () => {
      const observable = of();
      notificationStreamServiceMock.subscribe.mockReturnValue(observable);

      const request = {
        [REQUEST_CLIENT_KEY]: {
          sub: 'rider-77',
          role: EClientType.RIDER,
        },
      } as any;

      const result = controller.streamNotifications(request);

      expect(notificationStreamServiceMock.subscribe).toHaveBeenCalledWith(
        'rider',
        'rider-77',
      );
      expect(result).toBe(observable);
    });

    it('throws unauthorized when role is unsupported', () => {
      const request = {
        [REQUEST_CLIENT_KEY]: {
          sub: 'some-id',
          role: 999,
        },
      } as any;

      expect(() => controller.streamNotifications(request)).toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('getRide', () => {
    it('delegates ride formatting to RideResponseService and fetches candidates when applicable', async () => {
      const ride = {
        id: 'ride-1',
        status: ERideStatus.CANDIDATES_COMPUTED,
      } as any;
      const candidates = [{ driverId: '1' } as any];

      const ridesManagement = (controller as any).ridesManagementService as any;
      ridesManagement.getRideById = jest.fn().mockResolvedValue(ride);
      ridesManagement.listRideCandidates = jest
        .fn()
        .mockResolvedValue(candidates);
      rideResponseServiceMock.toRideResponse.mockReturnValue({
        id: ride.id,
        formatted: true,
      } as any);

      const req = {
        [REQUEST_CLIENT_KEY]: { sub: 'r1', role: EClientType.RIDER },
      } as any;

      const res = await controller.getRide(req, 'ride-1');

      expect(ridesManagement.listRideCandidates).toHaveBeenCalledWith('ride-1');
      expect(rideResponseServiceMock.toRideResponse).toHaveBeenCalledWith(
        ride,
        candidates,
      );
      expect(res.data).toEqual({ id: 'ride-1', formatted: true });
    });

    it('skips candidate lookup for completed rides', async () => {
      const ride = {
        id: 'ride-2',
        status: ERideStatus.COMPLETED,
      } as any;

      const ridesManagement = (controller as any).ridesManagementService as any;
      ridesManagement.getRideById = jest.fn().mockResolvedValue(ride);
      ridesManagement.listRideCandidates = jest.fn();

      const req = {
        [REQUEST_CLIENT_KEY]: { sub: 'r1', role: EClientType.RIDER },
      } as any;

      await controller.getRide(req, 'ride-2');

      expect(ridesManagement.listRideCandidates).not.toHaveBeenCalled();
      expect(rideResponseServiceMock.toRideResponse).toHaveBeenCalledWith(
        ride,
        undefined,
      );
    });
  });

  describe('payment flow endpoints', () => {
    it('proceedRidePayment merges ride response and payment payload', async () => {
      const ride = {
        id: 'ride-3',
        riderId: 'r99',
        driverId: 'd88',
        pickupLongitude: 0,
        pickupLatitude: 0,
        dropoffLongitude: 1,
        dropoffLatitude: 1,
        status: ERideStatus.CANDIDATES_COMPUTED,
        distanceActualKm: null,
        createdAt: '2025-01-03T00:00:00Z',
      };

      const payment = { provider: 'X', status: 'PENDING', token: 'abc' };

      const ridesPayment = (controller as any).ridesPaymentService as any;
      ridesPayment.proceedRidePayment = jest
        .fn()
        .mockResolvedValue({ ride, payment });

      const req = {
        [REQUEST_CLIENT_KEY]: { sub: 'r99', role: EClientType.RIDER },
      } as any;

      const res = await controller.proceedRidePayment(req, 'ride-3');

      expect(ridesPayment.proceedRidePayment).toHaveBeenCalledWith(
        'ride-3',
        'r99',
      );
      expect(res.data.payment).toEqual(payment);
      expect(res.data.id).toBe('ride-3');
    });

    it('handlePaymentNotification uses socket.remoteAddress when present', async () => {
      const ridesPayment = (controller as any).ridesPaymentService as any;
      ridesPayment.handlePaymentNotification = jest
        .fn()
        .mockResolvedValue(undefined);

      const req = {
        socket: { remoteAddress: '10.1.2.3' },
        ip: '1.2.3.4',
      } as any;
      const payload = { order_id: 'OID-1' } as any;

      const res = await controller.handlePaymentNotification(req, payload);

      expect(ridesPayment.handlePaymentNotification).toHaveBeenCalledWith(
        payload,
        '10.1.2.3',
      );
      expect(res.messageResponse).toMatch(/OID-1/);
    });

    it('handlePaymentNotification falls back to request.ip when socket address missing', async () => {
      const ridesPayment = (controller as any).ridesPaymentService as any;
      ridesPayment.handlePaymentNotification = jest
        .fn()
        .mockResolvedValue(undefined);

      const req = { socket: {}, ip: '1.2.3.4' } as any;
      const payload = { order_id: 'OID-2' } as any;

      await controller.handlePaymentNotification(req, payload);

      expect(ridesPayment.handlePaymentNotification).toHaveBeenCalledWith(
        payload,
        '1.2.3.4',
      );
    });

    it('handlePaymentNotification passes empty string if no ip info', async () => {
      const ridesPayment = (controller as any).ridesPaymentService as any;
      ridesPayment.handlePaymentNotification = jest
        .fn()
        .mockResolvedValue(undefined);

      const req = { socket: {}, ip: undefined } as any;
      const payload = { order_id: 'OID-3' } as any;

      await controller.handlePaymentNotification(req, payload);

      expect(ridesPayment.handlePaymentNotification).toHaveBeenCalledWith(
        payload,
        '',
      );
    });
  });

  describe('ride lifecycle endpoints', () => {
    it('createRide forwards to service and wraps response', async () => {
      const ridesManagement = (controller as any).ridesManagementService as any;
      ridesManagement.createRide = jest
        .fn()
        .mockResolvedValue({ rideId: 'new-1' });

      const req = {
        [REQUEST_CLIENT_KEY]: { sub: 'r10', role: EClientType.RIDER },
      } as any;
      const res = await controller.createRide(req, {
        pickupLongitude: 1,
        pickupLatitude: 2,
        dropoffLongitude: 3,
        dropoffLatitude: 4,
      } as any);

      expect(ridesManagement.createRide).toHaveBeenCalledWith(
        'r10',
        expect.any(Object),
      );
      expect(res.messageResponse).toBe('Ride requested');
      expect(res.data).toEqual({ rideId: 'new-1' });
    });

    it('cancelRide forwards to service and returns formatted response', async () => {
      const ridesManagement = (controller as any).ridesManagementService as any;
      ridesManagement.cancelRide = jest
        .fn()
        .mockResolvedValue({ id: 'rid-x', status: ERideStatus.CANCELED });

      const req = {
        [REQUEST_CLIENT_KEY]: { sub: 'r10', role: EClientType.RIDER },
      } as any;

      const res = await controller.cancelRide(req, 'rid-x', {
        reason: 'changed',
      } as any);

      expect(ridesManagement.cancelRide).toHaveBeenCalled();
      expect(res.statusCode).toBe(200);
      expect(res.message).toBe('Ride cancelled');
      expect(res.data.id).toBe('rid-x');
    });

    it('acceptRideAsDriver returns formatted response', async () => {
      const ridesManagement = (controller as any).ridesManagementService as any;
      ridesManagement.acceptRideByDriver = jest.fn().mockResolvedValue({
        id: 'rid-a',
        status: ERideStatus.ACCEPTED,
      });

      const req = {
        [REQUEST_CLIENT_KEY]: { sub: 'd55', role: EClientType.DRIVER },
      } as any;

      const res = await controller.acceptRideAsDriver(req, 'rid-a');
      expect(res.message).toBe('Ride accepted by driver');
      expect(res.data.id).toBe('rid-a');
    });

    it('rejectRideAsDriver returns formatted response', async () => {
      const ridesManagement = (controller as any).ridesManagementService as any;
      ridesManagement.rejectRideByDriver = jest.fn().mockResolvedValue({
        id: 'rid-r',
        status: ERideStatus.CANCELED,
      });

      const req = {
        [REQUEST_CLIENT_KEY]: { sub: 'd77', role: EClientType.DRIVER },
      } as any;

      const res = await controller.rejectRideAsDriver(req, 'rid-r', {
        reason: 'busy',
      } as any);
      expect(res.message).toBe('Ride rejected by driver');
      expect(res.data.id).toBe('rid-r');
    });

    it('confirmDriverAcceptance returns formatted response', async () => {
      const ridesManagement = (controller as any).ridesManagementService as any;
      ridesManagement.confirmDriverAcceptance = jest.fn().mockResolvedValue({
        id: 'rid-c',
        status: ERideStatus.ASSIGNED,
      });

      const req = {
        [REQUEST_CLIENT_KEY]: { sub: 'r88', role: EClientType.RIDER },
      } as any;

      const res = await controller.confirmDriverAcceptance(req, 'rid-c');
      expect(res.message).toBe('Ride confirmed by rider');
      expect(res.data.id).toBe('rid-c');
    });

    it('rejectDriverAcceptance returns formatted response', async () => {
      const ridesManagement = (controller as any).ridesManagementService as any;
      ridesManagement.rejectDriverAcceptance = jest.fn().mockResolvedValue({
        id: 'rid-j',
        status: ERideStatus.CANCELED,
      });

      const req = {
        [REQUEST_CLIENT_KEY]: { sub: 'r77', role: EClientType.RIDER },
      } as any;

      const res = await controller.rejectDriverAcceptance(req, 'rid-j', {
        reason: 'changed mind',
      } as any);
      expect(res.message).toBe('Ride rejected by rider');
      expect(res.data.id).toBe('rid-j');
    });
  });

  describe('rides tracking endpoints', () => {
    it('startRide forwards to service and wraps response', async () => {
      const ridesTracking = (controller as any).ridesTrackingService as any;
      ridesTracking.startRide = jest
        .fn()
        .mockResolvedValue({ id: 'rid-s', status: ERideStatus.ENROUTE });

      const req = {
        [REQUEST_CLIENT_KEY]: { sub: 'd11', role: EClientType.DRIVER },
      } as any;
      const res = await controller.startRide(req, 'rid-s', {
        driverLocation: { coordinate: { longitude: 1, latitude: 2 } },
      } as any);

      expect(ridesTracking.startRide).toHaveBeenCalled();
      expect(res.messageResponse).toBe('Ride started');
      expect(res.data.id).toBe('rid-s');
    });

    it('recordTripLocation forwards to service and returns 202 shape', async () => {
      const ridesTracking = (controller as any).ridesTrackingService as any;
      ridesTracking.recordTripLocation = jest.fn().mockResolvedValue(undefined);

      const req = {
        [REQUEST_CLIENT_KEY]: { sub: 'd22', role: EClientType.DRIVER },
      } as any;
      const res = await controller.recordTripLocation(req, 'rid-t', {
        location: {
          coordinate: { longitude: 1, latitude: 2 },
          recordedAt: 'mock_time',
        },
      });

      expect(ridesTracking.recordTripLocation).toHaveBeenCalled();
      expect(res).toEqual({ messageResponse: 'Location recorded', data: {} });
    });

    it('completeRide forwards to service and wraps response', async () => {
      const ridesTracking = (controller as any).ridesTrackingService as any;
      ridesTracking.completeRide = jest
        .fn()
        .mockResolvedValue({ id: 'rid-z', status: ERideStatus.COMPLETED });

      const req = {
        [REQUEST_CLIENT_KEY]: { sub: 'd33', role: EClientType.DRIVER },
      } as any;
      const res = await controller.completeRide(req, 'rid-z', {
        driverLocation: { coordinate: { longitude: 1, latitude: 2 } },
        discountAmount: 0,
      } as any);

      expect(ridesTracking.completeRide).toHaveBeenCalled();
      expect(res.messageResponse).toBe('Ride completed');
      expect(res.data.id).toBe('rid-z');
    });
  });

  /*
   * ===== ADD: client signup endpoints =====
   */
  describe('client signup endpoints', () => {
    it('signupRider returns created rider (lines 91-93)', async () => {
      const rider = { id: 'r-1', msisdn: 'abc123', role: 'mock-role' };
      clientServiceMock.signupRider.mockResolvedValue(rider);

      const res = await controller.signupRider({} as any);
      expect(clientServiceMock.signupRider).toHaveBeenCalled();
      expect(res).toEqual({ data: rider });
    });

    it('signupDriver returns created driver (lines 102-104)', async () => {
      const driver = { id: 'r-1', msisdn: 'abc123', role: 'mock-role' };
      clientServiceMock.signupDriver.mockResolvedValue(driver);

      const res = await controller.signupDriver({} as any);
      expect(clientServiceMock.signupDriver).toHaveBeenCalled();
      expect(res).toEqual({ data: driver });
    });
  });

  /*
   * ===== ADD: iam endpoints =====
   */
  describe('iam endpoints', () => {
    it('getOtp proxies to auth service (line 117)', async () => {
      authServiceMock.getOtp.mockResolvedValue('123456');
      const res = await controller.getOtp({ phone: '+62...' } as any);
      expect(authServiceMock.getOtp).toHaveBeenCalled();
      expect(res).toBe('123456');
    });

    it('verifyOtp sets cookies (lines 153-159)', async () => {
      authServiceMock.verifyOtp.mockResolvedValue({
        accessToken: 'acc',
        refreshToken: 'ref',
      });

      const cookie = jest.fn();
      await controller.verifyOtp({} as any, { cookie } as any);

      // called twice, once for accesstoken and once for refreshtoken
      expect(cookie).toHaveBeenNthCalledWith(
        1,
        'accesstoken',
        'acc',
        expect.objectContaining({
          secure: true,
          httpOnly: true,
          sameSite: true,
        }),
      );
      expect(cookie).toHaveBeenNthCalledWith(
        2,
        'refreshtoken',
        'ref',
        expect.objectContaining({
          secure: true,
          httpOnly: true,
          sameSite: true,
        }),
      );
    });

    it('getRefreshToken sets cookies (lines 174-180)', async () => {
      authServiceMock.getRefreshToken.mockResolvedValue({
        accessToken: 'new-acc',
        refreshToken: 'new-ref',
      });
      const cookie = jest.fn();
      await controller.getRefreshToken({} as any, { cookie } as any);

      expect(cookie).toHaveBeenNthCalledWith(
        1,
        'accesstoken',
        'new-acc',
        expect.objectContaining({
          secure: true,
          httpOnly: true,
          sameSite: true,
        }),
      );
      expect(cookie).toHaveBeenNthCalledWith(
        2,
        'refreshtoken',
        'new-ref',
        expect.objectContaining({
          secure: true,
          httpOnly: true,
          sameSite: true,
        }),
      );
    });

    it('logout returns auth service result (line 191)', async () => {
      authServiceMock.logout.mockResolvedValue(`success logout`);
      const res = await controller.logout({} as any);
      expect(authServiceMock.logout).toHaveBeenCalled();
      expect(res).toEqual(`success logout`);
    });
  });

  /*
   * ===== ADD: getClientId: numeric sub coerced to string (line 584) =====
   * Use a route that uses getClientId and passes it to a service.
   */
  describe('getClientId numeric coercion', () => {
    it('coerces numeric sub to string', async () => {
      const ridesPayment = (controller as any).ridesPaymentService as any;
      ridesPayment.proceedRidePayment = jest
        .fn()
        .mockResolvedValue({ ride: { id: 'rid' }, payment: {} });

      const req = {
        [REQUEST_CLIENT_KEY]: { sub: 999, role: EClientType.RIDER },
      } as any;
      await controller.proceedRidePayment(req, 'rid');

      // second arg passed to service must be string "999"
      expect(ridesPayment.proceedRidePayment).toHaveBeenCalledWith(
        'rid',
        '999',
      );
    });
  });
});
