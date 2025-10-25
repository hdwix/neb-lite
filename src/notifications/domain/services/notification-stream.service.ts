import { Injectable, Logger, MessageEvent } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';
import { finalize } from 'rxjs/operators';

export const OTP_SIMULATION_TARGET = 'otp-simulation' as const;

export type NotificationTarget =
  | 'driver'
  | 'rider'
  | typeof OTP_SIMULATION_TARGET;

interface NotificationEnvelope {
  target: NotificationTarget;
  targetId: string;
  event: string;
  payload: unknown;
  timestamp: string;
}

@Injectable()
export class NotificationStreamService {
  private readonly logger = new Logger(NotificationStreamService.name);
  private readonly channels = new Map<string, Set<Subject<MessageEvent>>>();

  subscribe(
    target: NotificationTarget,
    targetId: string,
  ): Observable<MessageEvent> {
    const channelKey = this.getChannelKey(target, targetId);
    const subscribers =
      this.channels.get(channelKey) ?? new Set<Subject<MessageEvent>>();
    const subject = new Subject<MessageEvent>();
    subscribers.add(subject);
    this.channels.set(channelKey, subscribers);
    this.logger.debug(
      `Registered SSE subscriber for ${channelKey}. Active connections: ${subscribers.size}`,
    );

    console.log('from subscribe : ');
    console.log(' target : ');
    console.log(target);
    console.log(' targetId : ');
    console.log(targetId);
    console.log(' channelKey : ');
    console.log(channelKey);
    console.log(' subscribers : ');
    console.log(' this.channels : ');
    console.log(this.channels);

    return subject.asObservable().pipe(
      finalize(() => {
        const channelSubscribers = this.channels.get(channelKey);
        subject.complete();
        if (!channelSubscribers) {
          return;
        }
        channelSubscribers.delete(subject);
        if (channelSubscribers.size === 0) {
          this.channels.delete(channelKey);
        }
        this.logger.debug(
          `SSE subscriber disconnected from ${channelKey}. Remaining connections: ${
            channelSubscribers.size ?? 0
          }`,
        );
      }),
    );
  }

  emit(
    target: NotificationTarget,
    targetId: string,
    event: string,
    payload: unknown,
  ): boolean {
    const channelKey = this.getChannelKey(target, targetId);
    const subscribers = this.channels.get(channelKey);
    console.log('from emit : ');
    console.log(' target : ');
    console.log(target);
    console.log(' targetId : ');
    console.log(targetId);
    console.log(' channelKey : ');
    console.log(channelKey);
    console.log(' subscribers : ');
    console.log(subscribers);
    console.log(' event : ');
    console.log(event);

    if (!subscribers || subscribers.size === 0) {
      this.logger.debug(
        `No SSE subscribers for ${channelKey}. Dropping ${event} notification.`,
      );
      return false;
    }

    const envelope: NotificationEnvelope = {
      target,
      targetId,
      event,
      payload,
      timestamp: new Date().toISOString(),
    };

    const message: MessageEvent = {
      type: event,
      data: envelope,
    };

    for (const subscriber of subscribers) {
      subscriber.next(message);
    }

    return true;
  }

  private getChannelKey(target: NotificationTarget, targetId: string): string {
    return `${target}:${targetId}`;
  }
}
