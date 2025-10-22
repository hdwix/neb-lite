import { Injectable, Logger } from '@nestjs/common';
import { Ride } from '../entities/ride.entity';
import {
  NotificationStreamService,
  NotificationTarget,
} from '../../../notifications/domain/services/notification-stream.service';

@Injectable()
export class RideNotificationService {
  private readonly logger = new Logger(RideNotificationService.name);

  constructor(
    private readonly notificationStreamService: NotificationStreamService,
  ) {}

  async notifyRideMatched(ride: Ride): Promise<void> {
    if (ride.driverId) {
      const driverMessage = `Ride ${ride.id} matched with rider ${ride.riderId}`;
      this.dispatchNotification('driver', ride.driverId, 'ride.matched', ride, driverMessage);
    }

    const riderMessage = ride.driverId
      ? `Driver ${ride.driverId} matched for ride ${ride.id}`
      : `Ride ${ride.id} matched. Awaiting driver confirmation`;
    this.dispatchNotification('rider', ride.riderId, 'ride.matched', ride, riderMessage);
  }

  async notifyDriverAccepted(ride: Ride): Promise<void> {
    const message = `Driver ${ride.driverId ?? 'unknown'} accepted ride ${ride.id}`;
    this.dispatchNotification('rider', ride.riderId, 'ride.driver.accepted', ride, message);
  }

  async notifyRiderConfirmed(ride: Ride): Promise<void> {
    if (!ride.driverId) {
      return;
    }

    const message = `Rider ${ride.riderId} confirmed ride ${ride.id}`;
    this.dispatchNotification('driver', ride.driverId, 'ride.rider.confirmed', ride, message);
  }

  async notifyRiderRejected(ride: Ride, reason?: string): Promise<void> {
    if (ride.driverId) {
      const driverMessage =
        `Rider ${ride.riderId} rejected ride ${ride.id}` + (reason ? `: ${reason}` : '');
      this.dispatchNotification(
        'driver',
        ride.driverId,
        'ride.rider.rejected',
        ride,
        driverMessage,
        { rejectionReason: reason ?? null },
      );
    }

    const riderMessage =
      `Ride ${ride.id} cancelled after rejecting driver` +
      (reason ? `: ${reason}` : '');
    this.dispatchNotification(
      'rider',
      ride.riderId,
      'ride.cancelled',
      ride,
      riderMessage,
      { rejectionReason: reason ?? null },
    );
  }

  private dispatchNotification(
    target: NotificationTarget,
    targetId: string,
    event: string,
    ride: Ride | Record<string, unknown>,
    message: string,
    extraPayload: Record<string, unknown> = {},
  ) {
    if (!targetId) {
      this.logger.warn(`Skipping notification for ${target} with missing identifier: ${message}`);
      return;
    }

    const payload = this.buildPayload(ride, message, extraPayload);
    const delivered = this.notificationStreamService.emit(
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
}
