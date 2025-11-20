import { Inject, Injectable, Logger } from '@nestjs/common';
import { Ride } from '../entities/ride.entity';
import { RideDriverCandidate } from '../entities/ride-driver-candidate.entity';
import {
  NOTIFICATION_PUBLISHER,
  NotificationPublisher,
  NotificationTarget,
} from '../../../notifications/domain/ports/notification-publisher.port';
import type { RouteEstimates } from './rides-management.service';

@Injectable()
export class RideNotificationService {
  private readonly logger = new Logger(RideNotificationService.name);

  constructor(
    @Inject(NOTIFICATION_PUBLISHER)
    private readonly notificationPublisher: NotificationPublisher,
  ) {}

  async notifyRideMatched(ride: Ride): Promise<void> {
    const riderMessage = 'awaiting driver responses';
    await this.dispatchNotification(
      'rider',
      ride.riderId,
      'ride.candidates.invited',
      ride,
      riderMessage,
    );
  }

  async notifyRideOffered(
    ride: Ride,
    candidate: RideDriverCandidate,
    route: RouteEstimates,
  ): Promise<void> {
    const message = 'New ride requested near you';
    await this.dispatchNotification(
      'driver',
      candidate.driverId,
      'ride.offer',
      ride,
      message,
      {
        candidate: this.buildCandidatePayload(candidate),
        route,
      },
    );
  }

  async notifyDriverAccepted(
    ride: Ride,
    candidate: RideDriverCandidate,
  ): Promise<void> {
    const message = `Driver ${candidate.driverId} accepted ride ${ride.id}`;
    await this.dispatchNotification(
      'rider',
      ride.riderId,
      'ride.driver.accepted',
      ride,
      message,
      { candidate: this.buildCandidatePayload(candidate) },
    );
  }

  async notifyDriverDeclined(
    ride: Ride,
    candidate: RideDriverCandidate,
  ): Promise<void> {
    const message = `Driver ${candidate.driverId} declined ride ${ride.id}`;
    await this.dispatchNotification(
      'rider',
      ride.riderId,
      'ride.driver.declined',
      ride,
      message,
      {
        candidate: this.buildCandidatePayload(candidate),
      },
    );
  }

  async notifyRiderConfirmed(
    ride: Ride,
    candidate: RideDriverCandidate,
  ): Promise<void> {
    if (!ride.driverId) {
      return;
    }

    const message = `Rider ${ride.riderId} confirmed ride ${ride.id}`;
    await this.dispatchNotification(
      'driver',
      ride.driverId,
      'ride.rider.confirmed',
      ride,
      message,
      { candidate: this.buildCandidatePayload(candidate) },
    );
  }

  async notifyRiderRejectedDriver(
    ride: Ride,
    candidate: RideDriverCandidate,
    reason?: string,
  ): Promise<void> {
    const driverMessage =
      `Rider ${ride.riderId} rejected ride ${ride.id}` +
      (reason ? `: ${reason}` : '');
    await this.dispatchNotification(
      'driver',
      candidate.driverId,
      'ride.rider.rejected',
      ride,
      driverMessage,
      {
        candidate: this.buildCandidatePayload(candidate),
        rejectionReason: reason ?? null,
      },
    );
  }

  async notifyCandidateSuperseded(
    ride: Ride,
    candidate: RideDriverCandidate,
  ): Promise<void> {
    const message = `Ride ${ride.id} is no longer available`;
    await this.dispatchNotification(
      'driver',
      candidate.driverId,
      'ride.driver.not_selected',
      ride,
      message,
      { candidate: this.buildCandidatePayload(candidate) },
    );
  }

  async notifyRideCanceledForCandidate(
    ride: Ride,
    candidate: RideDriverCandidate,
    reason?: string,
  ): Promise<void> {
    const message =
      `Ride ${ride.id} was cancelled by rider ${ride.riderId}` +
      (reason ? `: ${reason}` : '');
    await this.dispatchNotification(
      'driver',
      candidate.driverId,
      'ride.cancelled',
      ride,
      message,
      {
        candidate: this.buildCandidatePayload(candidate),
        cancellationReason: reason ?? null,
      },
    );
  }

  async notifyRideStarted(ride: Ride): Promise<void> {
    const riderMessage = `Ride ${ride.id} has started.`;
    if (!ride.driverId) {
      await this.dispatchNotification(
        'rider',
        ride.riderId,
        'ride.started.rider',
        ride,
        riderMessage,
      );
      return;
    }

    const driverMessage = `Ride ${ride.id} is now in progress.`;

    await Promise.all([
      this.dispatchNotification(
        'rider',
        ride.riderId,
        'ride.started.rider',
        ride,
        riderMessage,
      ),
      this.dispatchNotification(
        'driver',
        ride.driverId,
        'ride.started.driver',
        ride,
        driverMessage,
      ),
    ]);
  }

  async notifyRideCompleted(
    ride: Ride,
    summary: {
      baseFare: string;
      discountPercent: number;
      discountAmount: string;
      finalFare: string;
      appFee: string;
    },
  ): Promise<void> {
    const riderMessage = `Ride ${ride.id} completed. Fare due: Rp ${summary.finalFare}.`;
    if (!ride.driverId) {
      await this.dispatchNotification(
        'rider',
        ride.riderId,
        'ride.completed.rider',
        ride,
        riderMessage,
        { summary },
      );
      return;
    }

    const driverMessage = `Ride ${ride.id} completed. Fare: Rp ${summary.finalFare}.`;

    await Promise.all([
      this.dispatchNotification(
        'rider',
        ride.riderId,
        'ride.completed.rider',
        ride,
        riderMessage,
        { summary },
      ),
      this.dispatchNotification(
        'driver',
        ride.driverId,
        'ride.completed.driver',
        ride,
        driverMessage,
        { summary },
      ),
    ]);
  }

  async notifyRidePaid(ride: Ride, paymentReference?: string): Promise<void> {
    const extras = paymentReference ? { paymentReference } : {};
    const riderMessage = `Payment for ride ${ride.id} confirmed.`;
    if (!ride.driverId) {
      await this.dispatchNotification(
        'rider',
        ride.riderId,
        'ride.payment.completed.rider',
        ride,
        riderMessage,
        extras,
      );
      return;
    }

    const driverMessage = `Ride ${ride.id} payment has been received.`;

    await Promise.all([
      this.dispatchNotification(
        'rider',
        ride.riderId,
        'ride.payment.completed.rider',
        ride,
        riderMessage,
        extras,
      ),
      this.dispatchNotification(
        'driver',
        ride.driverId,
        'ride.payment.completed.driver',
        ride,
        driverMessage,
        extras,
      ),
    ]);
  }

  private async dispatchNotification(
    target: NotificationTarget,
    targetId: string,
    event: string,
    ride: Ride | Record<string, unknown>,
    message: string,
    extraPayload: Record<string, unknown> = {},
  ): Promise<void> {
    if (!targetId) {
      this.logger.warn(
        `Skipping notification for ${target} with missing identifier: ${message}`,
      );
      return;
    }

    const payload = this.buildPayload(ride, message, extraPayload);
    const delivered = await this.notificationPublisher.emit(
      target,
      targetId,
      event,
      payload,
    );

    if (!delivered) {
      this.logger.debug(
        `No active SSE clients for ${target} ${targetId}. Queued notification: ${message}`,
      );
    }

    this.logger.log(`Notification to ${target} ${targetId}: ${message}`);
  }

  private buildPayload(
    ride: Ride | Record<string, unknown>,
    message: string,
    extras: Record<string, unknown>,
  ) {
    if (ride && typeof ride === 'object' && 'id' in ride) {
      const rideEntity = ride as Ride;
      return {
        rideId: rideEntity.id,
        riderId: rideEntity.riderId,
        driverId: rideEntity.driverId ?? null,
        status: rideEntity.status,
        message,
        ...extras,
      };
    }

    return {
      rideId: undefined,
      message,
      ...extras,
      ...ride,
    };
  }

  private buildCandidatePayload(candidate: RideDriverCandidate) {
    return {
      driverId: candidate.driverId,
      status: candidate.status,
      reason: candidate.reason ?? null,
      distanceMeters: candidate.distanceMeters ?? null,
      respondedAt:
        candidate.respondedAt?.toISOString?.() ?? candidate.respondedAt ?? null,
      createdAt:
        candidate.createdAt?.toISOString?.() ?? candidate.createdAt ?? null,
    };
  }
}
