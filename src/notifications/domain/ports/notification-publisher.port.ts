import { MessageEvent } from '@nestjs/common';
import { Observable } from 'rxjs';

export const NOTIFICATION_PUBLISHER = Symbol('NOTIFICATION_PUBLISHER');
export const OTP_SIMULATION_TARGET = 'otp-simulation' as const;

export type NotificationTarget =
  | 'driver'
  | 'rider'
  | typeof OTP_SIMULATION_TARGET;

export interface NotificationPublisher {
  emit(
    target: NotificationTarget,
    targetId: string,
    event: string,
    payload: unknown,
  ): Promise<boolean>;
}

export interface NotificationStreamSubscriber {
  subscribe(
    target: NotificationTarget,
    targetId: string,
  ): Observable<MessageEvent>;
}
