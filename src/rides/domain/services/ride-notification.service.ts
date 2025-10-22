import { Injectable, Logger } from '@nestjs/common';
import { Ride } from '../entities/ride.entity';

@Injectable()
export class RideNotificationService {
  private readonly logger = new Logger(RideNotificationService.name);

  async notifyRideMatched(ride: Ride): Promise<void> {
    if (ride.driverId) {
      this.logNotification(
        'driver',
        ride.driverId,
        `Ride ${ride.id} matched with rider ${ride.riderId}`,
      );
    }

    this.logNotification(
      'rider',
      ride.riderId,
      ride.driverId
        ? `Driver ${ride.driverId} matched for ride ${ride.id}`
        : `Ride ${ride.id} matched. Awaiting driver confirmation`,
    );
  }

  async notifyDriverAccepted(ride: Ride): Promise<void> {
    this.logNotification(
      'rider',
      ride.riderId,
      `Driver ${ride.driverId ?? 'unknown'} accepted ride ${ride.id}`,
    );
  }

  async notifyRiderConfirmed(ride: Ride): Promise<void> {
    if (!ride.driverId) {
      return;
    }

    this.logNotification(
      'driver',
      ride.driverId,
      `Rider ${ride.riderId} confirmed ride ${ride.id}`,
    );
  }

  async notifyRiderRejected(ride: Ride, reason?: string): Promise<void> {
    if (ride.driverId) {
      this.logNotification(
        'driver',
        ride.driverId,
        `Rider ${ride.riderId} rejected ride ${ride.id}` +
          (reason ? `: ${reason}` : ''),
      );
    }

    this.logNotification(
      'rider',
      ride.riderId,
      `Ride ${ride.id} cancelled after rejecting driver` +
        (reason ? `: ${reason}` : ''),
    );
  }

  private logNotification(target: string, targetId: string, message: string) {
    this.logger.log(`Notification to ${target} ${targetId}: ${message}`);
  }
}
