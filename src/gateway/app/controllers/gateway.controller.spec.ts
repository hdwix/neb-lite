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

  describe('getRide / toRideResponse math & candidates', () => {
    it('includes computed fare fields and candidates when ride not completed', async () => {
      const ride = {
        id: 'ride-1',
        riderId: 'r1',
        driverId: 'd1',
        pickupLongitude: 106.8,
        pickupLatitude: -6.2,
        dropoffLongitude: 106.9,
        dropoffLatitude: -6.3,
        status: ERideStatus.CANDIDATES_COMPUTED,
        fareEstimated: 10000,
        fareFinal: null,
        distanceEstimatedKm: 3.2,
        durationEstimatedSeconds: 600,
        distanceActualKm: 2.345, // triggers base fare calculation path
        discountPercent: null,
        discountAmount: 500, // driver discount (number or string OK)
        appFeeAmount: '1000', // string to exercise parseCurrency normalization
        paymentUrl: null,
        paymentStatus: null,
        createdAt: new Date('2025-01-01T00:00:00Z'),
      };

      const candidates = [
        {
          driverId: 'D-01',
          status: 'PENDING',
          reason: null,
          distanceMeters: 321,
          respondedAt: new Date('2025-01-01T00:05:00Z'),
          createdAt: new Date('2025-01-01T00:01:00Z'),
        },
        {
          driverId: 'D-02',
          status: 'REJECTED',
          reason: 'Far',
          distanceMeters: 700,
          respondedAt: null,
          createdAt: new Date('2025-01-01T00:02:00Z'),
        },
      ];

      // service mocks
      const ridesManagement = (controller as any).ridesManagementService as any;
      ridesManagement.getRideById = jest.fn().mockResolvedValue(ride);
      ridesManagement.listRideCandidates = jest
        .fn()
        .mockResolvedValue(candidates);

      const req = {
        [REQUEST_CLIENT_KEY]: { sub: 'r1', role: EClientType.RIDER },
      } as any;

      const res = await controller.getRide(req, 'ride-1');

      // Default fare rate per km in ctor is 3000 (from getNumberConfig fallback)
      // baseFare = 2.345 * 3000 = 7035 -> 7035.00 after toFixed(2)
      // fareAfterDiscount = 7035 - 500 = 6535
      // finalFare = fareAfterDiscount + appFee(1000) = 7535 -> '7535.00'
      expect(res.data.baseFare).toBe('7035.00');
      expect(res.data.fareRatePerKm).toBe(3000);
      expect(res.data.discountAmountByDriver).toBe('500.00');
      expect(res.data.fareAfterDiscount).toBe('6535.00');
      expect(res.data.finalFare).toBe('7535.00');

      // candidates mapped & iso strings handled
      expect(res.data.candidates).toEqual([
        {
          driverId: 'D-01',
          status: 'PENDING',
          reason: null,
          distanceMeters: 321,
          respondedAt: '2025-01-01T00:05:00.000Z',
          createdAt: '2025-01-01T00:01:00.000Z',
        },
        {
          driverId: 'D-02',
          status: 'REJECTED',
          reason: 'Far',
          distanceMeters: 700,
          respondedAt: null,
          createdAt: '2025-01-01T00:02:00.000Z',
        },
      ]);
    });

    it('omits candidates section when ride is completed', async () => {
      const ride = {
        id: 'ride-2',
        riderId: 'r1',
        driverId: 'd1',
        pickupLongitude: 1,
        pickupLatitude: 1,
        dropoffLongitude: 2,
        dropoffLatitude: 2,
        status: ERideStatus.COMPLETED, // completed => should NOT fetch / include candidates
        distanceActualKm: null, // keeps base fare path disabled
        createdAt: '2025-01-02T00:00:00Z',
      };

      const ridesManagement = (controller as any).ridesManagementService as any;
      ridesManagement.getRideById = jest.fn().mockResolvedValue(ride);
      ridesManagement.listRideCandidates = jest.fn(); // should not be called

      const req = {
        [REQUEST_CLIENT_KEY]: { sub: 'r1', role: EClientType.RIDER },
      } as any;

      const res = await controller.getRide(req, 'ride-2');

      expect(ridesManagement.listRideCandidates).not.toHaveBeenCalled();
      expect(res.data.candidates).toBeUndefined(); // no candidates section
      expect(res.data.baseFare).toBeUndefined(); // no base fare when distanceActualKm is null
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

  /*
   * ===== ADD: getNumberConfig branches (lines 663, 667-669) =====
   * Rebuild the module to control the ConfigService return for constructor.
   */
  describe('getNumberConfig branches (constructor defaultFareRatePerKm)', () => {
    const makeCtrl = async (configGet: (k: string) => any) => {
      const module = await Test.createTestingModule({
        controllers: [GatewayController],
        providers: [
          { provide: AuthenticationService, useValue: authServiceMock },
          { provide: LocationService, useValue: locationServiceMock },
          {
            provide: RidesManagementService,
            useValue: {
              createRide: jest.fn(),
              getRideById: jest.fn(),
              listRideCandidates: jest.fn(),
            },
          },
          {
            provide: RidesTrackingService,
            useValue: {
              startRide: jest.fn(),
              recordTripLocation: jest.fn(),
              completeRide: jest.fn(),
            },
          },
          {
            provide: RidesPaymentService,
            useValue: {
              proceedRidePayment: jest.fn(),
              handlePaymentNotification: jest.fn(),
            },
          },
          {
            provide: NotificationStreamAdapter,
            useValue: notificationStreamServiceMock,
          },
          { provide: ClientService, useValue: clientServiceMock },
          { provide: ConfigService, useValue: { get: jest.fn(configGet) } },
        ],
      }).compile();
      return module.get<GatewayController>(GatewayController);
    };

    const computeBaseFare = async (ctrl: GatewayController, rate: number) => {
      // Force a ride with distanceActualKm to exercise baseFare = distance * rate
      const ride = {
        id: 'r',
        riderId: 'x',
        driverId: 'y',
        pickupLongitude: 0,
        pickupLatitude: 0,
        dropoffLongitude: 0,
        dropoffLatitude: 0,
        status: ERideStatus.CANDIDATES_COMPUTED,
        distanceActualKm: 2,
        createdAt: '2025-01-01T00:00:00Z',
      };
      (ctrl as any).ridesManagementService.getRideById = jest
        .fn()
        .mockResolvedValue(ride);
      (ctrl as any).ridesManagementService.listRideCandidates = jest
        .fn()
        .mockResolvedValue([]);

      const res = await ctrl.getRide(
        { [REQUEST_CLIENT_KEY]: { sub: 'x', role: EClientType.RIDER } } as any,
        'r',
      );
      return res.data.baseFare; // string with 2 decimals
    };

    it('uses numeric config value directly (line 663)', async () => {
      const ctrl = await makeCtrl((k) =>
        k === 'DEFAULT_FARE_RATE_PER_KM' ? 4000 : undefined,
      );
      const baseFare = await computeBaseFare(ctrl, 4000);
      expect(baseFare).toBe('8000.00'); // 2 * 4000
    });

    it('parses string number config (line 663 string branch)', async () => {
      const ctrl = await makeCtrl((k) =>
        k === 'DEFAULT_FARE_RATE_PER_KM' ? '3500' : undefined,
      );
      const baseFare = await computeBaseFare(ctrl, 3500);
      expect(baseFare).toBe('7000.00'); // 2 * 3500
    });

    it('falls back to default on invalid/undefined (lines 667-669)', async () => {
      const ctrl = await makeCtrl((k) =>
        k === 'DEFAULT_FARE_RATE_PER_KM' ? 'oops' : undefined,
      );
      // default is 3000
      const baseFare = await computeBaseFare(ctrl, 3000);
      expect(baseFare).toBe('6000.00'); // 2 * 3000
    });
  });

  it('returns null for non-finite currency values (Number.isFinite guard)', async () => {
    const ride = {
      id: 'ride-nan',
      riderId: 'r1',
      driverId: 'd1',
      pickupLongitude: 0,
      pickupLatitude: 0,
      dropoffLongitude: 0,
      dropoffLatitude: 0,
      status: ERideStatus.CANDIDATES_COMPUTED,
      distanceActualKm: null, // disables base fare path
      fareFinal: 'oops', // triggers parseCurrency -> Number('oops') => NaN
      createdAt: '2025-01-05T00:00:00Z',
    };

    const ridesManagement = (controller as any).ridesManagementService as any;
    ridesManagement.getRideById = jest.fn().mockResolvedValue(ride);
    ridesManagement.listRideCandidates = jest.fn().mockResolvedValue([]);

    const req = {
      [REQUEST_CLIENT_KEY]: { sub: 'r1', role: EClientType.RIDER },
    } as any;

    const res = await controller.getRide(req, 'ride-nan');

    // computed 'finalFare' is only set when baseFare !== null -> here it's undefined
    expect(res.data.finalFare).toBeUndefined();

    // raw copy remains on 'fareFinal'
    expect(res.data.fareFinal).toBe('oops');

    // also ensure base fare block didn't run
    expect(res.data.baseFare).toBeUndefined();
  });

  it('handles negative currency (becomes null/0) and string/undefined candidate timestamps', async () => {
    const ride = {
      id: 'ride-neg',
      riderId: 'r1',
      driverId: 'd1',
      pickupLongitude: 106.7,
      pickupLatitude: -6.2,
      dropoffLongitude: 106.8,
      dropoffLatitude: -6.3,
      status: ERideStatus.CANDIDATES_COMPUTED, // ensures candidates are included
      distanceActualKm: 1, // baseFare path enabled (1 * 3000)
      discountAmount: -200, // parseCurrency -> rounded < 0 => null -> ?? 0
      appFeeAmount: -100, // parseCurrency -> null -> (appFeeAmount ?? 0) = 0
      createdAt: '2025-01-06T00:00:00Z',
    };

    const candidates = [
      // string timestamps: exercises `?.toISOString?.() ?? candidate.respondedAt`
      {
        driverId: 'D-STR',
        status: 'PENDING',
        reason: null,
        distanceMeters: 123,
        respondedAt: '2025-01-06T00:05:00.000Z', // string, not Date
        createdAt: '2025-01-06T00:01:00.000Z', // string, not Date
      },
      // undefined timestamps: exercises final `?? null`
      {
        driverId: 'D-UNDEF',
        status: 'REJECTED',
        reason: 'Busy',
        distanceMeters: 456,
        respondedAt: undefined,
        createdAt: undefined,
      },
    ];

    const ridesManagement = (controller as any).ridesManagementService as any;
    ridesManagement.getRideById = jest.fn().mockResolvedValue(ride);
    ridesManagement.listRideCandidates = jest
      .fn()
      .mockResolvedValue(candidates);

    const req = {
      [REQUEST_CLIENT_KEY]: { sub: 'r1', role: EClientType.RIDER },
    } as any;

    const res = await controller.getRide(req, 'ride-neg');

    // Base fare from 1 km * default 3000
    expect(res.data.baseFare).toBe('3000.00');
    // Negative discount becomes null via parseCurrency, then `?? 0` => 0.00 shown
    expect(res.data.discountAmountByDriver).toBe('0.00');
    // App fee negative -> null -> `?? 0` => fareAfterDiscount = baseFare + 0
    expect(res.data.fareAfterDiscount).toBe('3000.00');
    expect(res.data.finalFare).toBe('3000.00');

    // Candidate timestamps: string passthrough and undefined -> null
    expect(res.data.candidates).toEqual([
      {
        driverId: 'D-STR',
        status: 'PENDING',
        reason: null,
        distanceMeters: 123,
        respondedAt: '2025-01-06T00:05:00.000Z', // kept as string
        createdAt: '2025-01-06T00:01:00.000Z', // kept as string
      },
      {
        driverId: 'D-UNDEF',
        status: 'REJECTED',
        reason: 'Busy',
        distanceMeters: 456,
        respondedAt: null, // undefined -> null by `?? null`
        createdAt: null, // undefined -> null by `?? null`
      },
    ]);
  });
});
