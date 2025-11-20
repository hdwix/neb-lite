import {
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { RidesPaymentService } from './rides-payment.service';
import { ERideStatus } from '../constants/ride-status.enum';
import { ERidePaymentStatus } from '../constants/ride-payment-status.enum';

describe('RidesPaymentService', () => {
  const ridePaymentRepository = {
    findById: jest.fn(),
    updatePaymentState: jest.fn(),
  } as any;
  const ridePaymentDetailRepository = {
    findByRideId: jest.fn(),
    findByOrderId: jest.fn(),
    saveDetailWithRideUpdate: jest.fn(),
  } as any;
  const paymentWhitelistRepository = {
    isIpAllowed: jest.fn(),
  } as any;
  const paymentService = {
    initiatePayment: jest.fn(),
    formatPaymentDetail: jest.fn((detail) => ({ formatted: detail })),
    applyNotification: jest.fn(),
  } as any;
  const rideRepository = {
    findById: jest.fn(),
  } as any;
  const notificationService = {
    notifyRidePaid: jest.fn(),
  } as any;

  let service: RidesPaymentService;

  const baseRide = {
    id: 'ride-1',
    riderId: 'rider-1',
    driverId: 'driver-1',
    status: ERideStatus.COMPLETED,
    paymentStatus: ERidePaymentStatus.PENDING,
    paymentUrl: 'url',
  } as any;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new RidesPaymentService(
      ridePaymentRepository,
      ridePaymentDetailRepository,
      paymentWhitelistRepository,
      paymentService,
      rideRepository,
      notificationService,
    );
  });

  describe('proceedRidePayment', () => {
    it('throws when ride is not found', async () => {
      ridePaymentRepository.findById.mockResolvedValue(null);

      await expect(
        service.proceedRidePayment('missing', baseRide.riderId),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws when rider does not own ride', async () => {
      ridePaymentRepository.findById.mockResolvedValue({
        ...baseRide,
        riderId: 'other',
      });

      await expect(
        service.proceedRidePayment(baseRide.id, baseRide.riderId),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('throws when ride is not completed', async () => {
      ridePaymentRepository.findById.mockResolvedValue({
        ...baseRide,
        status: ERideStatus.ENROUTE,
      });

      await expect(
        service.proceedRidePayment(baseRide.id, baseRide.riderId),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('returns formatted payment when already paid', async () => {
      const detail = { id: 'detail-1' };
      ridePaymentRepository.findById.mockResolvedValue({
        ...baseRide,
        paymentStatus: ERidePaymentStatus.PAID,
      });
      ridePaymentDetailRepository.findByRideId.mockResolvedValue(detail);

      const result = await service.proceedRidePayment(
        baseRide.id,
        baseRide.riderId,
      );

      expect(result.ride.paymentStatus).toBe(ERidePaymentStatus.PAID);
      expect(result.payment).toEqual({ formatted: detail });
      expect(paymentService.initiatePayment).not.toHaveBeenCalled();
    });

    it('initiates payment and refreshes ride', async () => {
      const paymentDetail = { id: 'detail-2', redirectUrl: 'https://pay' } as any;
      const refreshed = { ...baseRide, paymentStatus: ERidePaymentStatus.ON_PROCESS };
      ridePaymentRepository.findById
        .mockResolvedValueOnce(baseRide)
        .mockResolvedValueOnce(refreshed);
      paymentService.initiatePayment.mockResolvedValue(paymentDetail);

      const result = await service.proceedRidePayment(
        baseRide.id,
        baseRide.riderId,
      );

      expect(paymentService.initiatePayment).toHaveBeenCalledWith(baseRide);
      expect(ridePaymentRepository.updatePaymentState).toHaveBeenCalledWith(
        baseRide.id,
        ERidePaymentStatus.ON_PROCESS,
        paymentDetail.redirectUrl,
      );
      expect(result.ride).toEqual(refreshed);
      expect(result.payment).toEqual({ formatted: paymentDetail });
    });
  });

  describe('handlePaymentNotification', () => {
    const payloadBase = { order_id: 'order-1' } as any;

    it('rejects when IP is not allowed', async () => {
      paymentWhitelistRepository.isIpAllowed.mockResolvedValue(false);

      await expect(
        service.handlePaymentNotification(payloadBase, '127.0.0.1'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(paymentWhitelistRepository.isIpAllowed).toHaveBeenCalledWith([
        '127.0.0.1',
        '::ffff:127.0.0.1',
      ]);
    });

    it('rejects when order id missing', async () => {
      paymentWhitelistRepository.isIpAllowed.mockResolvedValue(true);

      await expect(
        service.handlePaymentNotification({} as any, 'ip'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects when payment detail not found', async () => {
      paymentWhitelistRepository.isIpAllowed.mockResolvedValue(true);
      ridePaymentDetailRepository.findByOrderId.mockResolvedValue(null);

      await expect(
        service.handlePaymentNotification(payloadBase, 'ip'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects when ride not found', async () => {
      paymentWhitelistRepository.isIpAllowed.mockResolvedValue(true);
      ridePaymentDetailRepository.findByOrderId.mockResolvedValue({
        rideId: 'ride-x',
      });
      rideRepository.findById.mockResolvedValue(null);

      await expect(
        service.handlePaymentNotification(payloadBase, 'ip'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('processes notification and emits ride paid', async () => {
      const paymentDetail = { rideId: baseRide.id, id: 'detail-x' } as any;
      const updatedDetail = { ...paymentDetail, orderId: 'order-1' } as any;
      const refreshedRide = { ...baseRide, paymentStatus: ERidePaymentStatus.PAID };

      paymentWhitelistRepository.isIpAllowed.mockResolvedValue(true);
      ridePaymentDetailRepository.findByOrderId.mockResolvedValue(paymentDetail);
      rideRepository.findById.mockResolvedValueOnce(baseRide).mockResolvedValueOnce(refreshedRide);
      paymentService.applyNotification.mockResolvedValue({
        detail: updatedDetail,
        paid: true,
        outboxUpdate: { status: 'processed', lastError: null, setProcessedAt: true },
      });
      ridePaymentDetailRepository.saveDetailWithRideUpdate.mockResolvedValue(
        updatedDetail,
      );

      const result = await service.handlePaymentNotification(
        { ...payloadBase, transaction_id: 'tx-1' } as any,
        '10.0.0.1',
      );

      expect(ridePaymentDetailRepository.saveDetailWithRideUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          detail: updatedDetail,
          rideUpdate: expect.objectContaining({ paymentStatus: ERidePaymentStatus.PAID }),
          outboxUpdate: expect.objectContaining({ status: 'processed' }),
        }),
      );
      expect(notificationService.notifyRidePaid).toHaveBeenCalledWith(
        refreshedRide,
        'tx-1',
      );
      expect(result.payment).toEqual({ formatted: updatedDetail });
    });

    it('handles unpaid notification without emitting paid event', async () => {
      const paymentDetail = { rideId: baseRide.id, id: 'detail-y', orderId: 'order-1' } as any;
      paymentWhitelistRepository.isIpAllowed.mockResolvedValue(true);
      ridePaymentDetailRepository.findByOrderId.mockResolvedValue(paymentDetail);
      rideRepository.findById.mockResolvedValue(baseRide);
      paymentService.applyNotification.mockResolvedValue({
        detail: paymentDetail,
        paid: false,
        outboxUpdate: undefined,
      });
      ridePaymentDetailRepository.saveDetailWithRideUpdate.mockResolvedValue(
        paymentDetail,
      );

      const result = await service.handlePaymentNotification(
        payloadBase,
        '::ffff:8.8.8.8',
      );

      expect(notificationService.notifyRidePaid).not.toHaveBeenCalled();
      expect(ridePaymentDetailRepository.saveDetailWithRideUpdate).toHaveBeenCalledWith(
        { detail: paymentDetail, rideUpdate: undefined, outboxUpdate: undefined },
      );
      expect(result.ride).toEqual(baseRide);
    });
  });
});
