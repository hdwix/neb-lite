import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { RidePaymentRepository } from '../../infrastructure/repositories/ride-payment.repository';
import { RidePaymentDetailRepository } from '../../infrastructure/repositories/ride-payment-detail.repository';
import { PaymentIpWhitelistRepository } from '../../infrastructure/repositories/payment-ip-whitelist.repository';
import { PaymentService } from './payment.service';
import { RideNotificationService } from './ride-notification.service';
import { ERideStatus } from '../constants/ride-status.enum';
import { ERidePaymentStatus } from '../constants/ride-payment-status.enum';
import { Ride } from '../entities/ride.entity';
import { PaymentNotificationDto } from '../../app/dto/payment-notification.dto';
import { RideRepository } from '../../infrastructure/repositories/ride.repository';

@Injectable()
export class RidesPaymentService {
  private readonly logger = new Logger(RidesPaymentService.name);

  constructor(
    private readonly ridePaymentRepository: RidePaymentRepository,
    private readonly ridePaymentDetailRepository: RidePaymentDetailRepository,
    private readonly paymentWhitelistRepository: PaymentIpWhitelistRepository,
    private readonly paymentService: PaymentService,
    private readonly rideRepository: RideRepository,
    private readonly notificationService: RideNotificationService,
  ) {}

  async proceedRidePayment(
    rideId: string,
    riderId: string,
  ): Promise<{ ride: Ride; payment: Record<string, unknown> | null }> {
    const ride = await this.ridePaymentRepository.findById(rideId);
    if (!ride) {
      this.logger.error(
        `Proceed payment failed: ride ${rideId} not found for rider ${riderId}`,
      );
      throw new NotFoundException('Ride not found');
    }

    if (ride.riderId !== riderId) {
      this.logger.error(
        `Proceed payment unauthorized: rider ${riderId} attempted ride ${rideId} owned by ${ride.riderId}`,
      );
      throw new UnauthorizedException('Ride not available for this rider');
    }

    if (ride.status !== ERideStatus.COMPLETED) {
      this.logger.error(
        `Proceed payment rejected: ride ${rideId} status ${ride.status} is not completed`,
      );
      throw new BadRequestException('Ride must be completed before payment');
    }

    if (ride.paymentStatus === ERidePaymentStatus.PAID) {
      const existingDetail =
        await this.ridePaymentDetailRepository.findByRideId(ride.id);
      return {
        ride,
        payment: this.paymentService.formatPaymentDetail(existingDetail),
      };
    }

    const paymentDetail = await this.paymentService.initiatePayment(ride);

    await this.ridePaymentRepository.updatePaymentState(
      ride.id,
      ERidePaymentStatus.ON_PROCESS,
      paymentDetail.redirectUrl ?? null,
    );

    const refreshedRide =
      (await this.ridePaymentRepository.findById(ride.id)) ?? ride;

    return {
      ride: refreshedRide,
      payment: this.paymentService.formatPaymentDetail(paymentDetail),
    };
  }

  async handlePaymentNotification(
    payload: PaymentNotificationDto,
    sourceIp: string,
  ): Promise<{ ride: Ride; payment: Record<string, unknown> | null }> {
    const allowed = await this.paymentWhitelistRepository.isIpAllowed(
      this.normalizeIpAddresses(sourceIp),
    );

    if (!allowed) {
      this.logger.error(
        `Payment notification rejected: source IP ${sourceIp} not allowed`,
      );
      throw new UnauthorizedException('Source IP not allowed');
    }

    if (!payload.order_id) {
      this.logger.error('Payment notification rejected: missing order_id');
      throw new BadRequestException('order_id is required');
    }

    const paymentDetail = await this.ridePaymentDetailRepository.findByOrderId(
      payload.order_id,
    );

    if (!paymentDetail) {
      this.logger.error(
        `Payment notification rejected: payment detail not found for order ${payload.order_id}`,
      );
      throw new NotFoundException(
        'Payment detail not found for this notification',
      );
    }

    const ride = await this.rideRepository.findById(paymentDetail.rideId);
    if (!ride) {
      this.logger.error(
        `Payment notification rejected: ride ${paymentDetail.rideId} not found for order ${payload.order_id}`,
      );
      throw new NotFoundException('Ride not found');
    }

    const {
      detail: updatedDetail,
      paid,
      outboxUpdate,
    } = await this.paymentService.applyNotification(
      ride,
      payload,
      paymentDetail,
    );

    if (paid) {
      ride.paymentStatus = ERidePaymentStatus.PAID;
      ride.paymentUrl = null;
    }

    const nextStatus = paid ? ERidePaymentStatus.PAID : null;
    const savedDetail =
      await this.ridePaymentDetailRepository.saveDetailWithRideUpdate({
        detail: updatedDetail,
        rideUpdate: paid
          ? {
              rideId: ride.id,
              paymentStatus: nextStatus,
              paymentUrl: null,
            }
          : undefined,
        outboxUpdate: outboxUpdate
          ? {
              rideId: ride.id,
              paymentDetailId: updatedDetail.id,
              orderId: updatedDetail.orderId ?? payload.order_id,
              status: outboxUpdate.status,
              lastError: outboxUpdate.lastError,
              setProcessedAt: outboxUpdate.setProcessedAt,
            }
          : undefined,
      });

    const refreshedRide = (await this.rideRepository.findById(ride.id)) ?? ride;

    if (paid) {
      await this.notificationService.notifyRidePaid(
        refreshedRide,
        payload.transaction_id ?? undefined,
      );
    }

    return {
      ride: refreshedRide,
      payment: this.paymentService.formatPaymentDetail(savedDetail),
    };
  }

  private normalizeIpAddresses(ip: string): string[] {
    if (!ip) {
      return [];
    }

    const trimmed = ip.trim();
    if (!trimmed) {
      return [];
    }

    const candidates = new Set<string>([trimmed]);

    if (trimmed.startsWith('::ffff:')) {
      candidates.add(trimmed.substring(7));
    } else if (/^\d+\.\d+\.\d+\.\d+$/.test(trimmed)) {
      candidates.add(`::ffff:${trimmed}`);
    }

    return Array.from(candidates);
  }
}
