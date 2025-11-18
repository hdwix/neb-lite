import {
  Inject,
  Injectable,
  Logger,
  MessageEvent,
  OnModuleDestroy,
} from '@nestjs/common';
import Redis from 'ioredis';
import { Observable, Subject } from 'rxjs';
import { finalize } from 'rxjs/operators';
import { REDIS_CLIENT } from '../../../infrastructure/redis/redis.tokens';
import {
  NotificationPublisher,
  NotificationStreamSubscriber,
  NotificationTarget,
} from '../../domain/ports/notification-publisher.port';

interface NotificationEnvelope {
  target: NotificationTarget;
  targetId: string;
  event: string;
  payload: unknown;
  timestamp: string;
}

@Injectable()
export class NotificationStreamAdapter
  implements NotificationPublisher, NotificationStreamSubscriber, OnModuleDestroy
{
  private readonly logger = new Logger(NotificationStreamAdapter.name);
  private readonly channels = new Map<string, Set<Subject<MessageEvent>>>();
  private readonly redisPublisher: Redis;
  private readonly redisSubscriber: Redis;
  private readonly redisSubscribedChannels = new Set<string>();
  private readonly redisSubscriptionPromises = new Map<string, Promise<void>>();

  constructor(@Inject(REDIS_CLIENT) redisClient: Redis) {
    this.redisPublisher = redisClient.duplicate();
    this.redisSubscriber = redisClient.duplicate();

    const handleRedisError = (error: Error) => {
      this.logger.error(`Redis connection error: ${error.message ?? error}`);
    };

    this.redisPublisher.on('error', handleRedisError);
    this.redisSubscriber.on('error', handleRedisError);

    this.redisSubscriber.on('message', (channel, rawPayload) => {
      this.handleRedisMessage(channel, rawPayload);
    });
  }

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

    this.ensureRedisSubscription(channelKey);

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
          this.cleanupRedisSubscription(channelKey);
        }
        this.logger.debug(
          `SSE subscriber disconnected from ${channelKey}. Remaining connections: ${
            channelSubscribers.size ?? 0
          }`,
        );
      }),
    );
  }

  async emit(
    target: NotificationTarget,
    targetId: string,
    event: string,
    payload: unknown,
  ): Promise<boolean> {
    const channelKey = this.getChannelKey(target, targetId);
    const envelope: NotificationEnvelope = {
      target,
      targetId,
      event,
      payload,
      timestamp: new Date().toISOString(),
    };

    try {
      await this.waitForRedisSubscription(channelKey);
      const publishedCount = await this.redisPublisher.publish(
        this.getRedisChannel(channelKey),
        JSON.stringify(envelope),
      );

      if (publishedCount === 0) {
        this.logger.debug(
          `No active SSE subscribers for ${channelKey}. Dropping ${event} notification.`,
        );
        return false;
      }

      return true;
    } catch (error) {
      this.logger.error(
        `Failed to publish ${event} notification for ${channelKey}: ${error}`,
      );
      return false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.redisSubscriber.quit();
    } catch (error) {
      this.logger.warn(`Failed to close redis subscriber connection: ${error}`);
    }

    try {
      await this.redisPublisher.quit();
    } catch (error) {
      this.logger.warn(`Failed to close redis publisher connection: ${error}`);
    }
  }

  private ensureRedisSubscription(channelKey: string): void {
    const redisChannel = this.getRedisChannel(channelKey);

    if (
      this.redisSubscribedChannels.has(redisChannel) ||
      this.redisSubscriptionPromises.has(redisChannel)
    ) {
      return;
    }

    const subscriptionPromise = this.redisSubscriber
      .subscribe(redisChannel)
      .then(() => {
        this.redisSubscribedChannels.add(redisChannel);
      })
      .catch((error) => {
        this.logger.error(
          `Failed to subscribe to redis channel ${redisChannel}: ${error}`,
        );
        this.redisSubscribedChannels.delete(redisChannel);
        throw error;
      })
      .finally(() => {
        this.redisSubscriptionPromises.delete(redisChannel);
      });

    this.redisSubscriptionPromises.set(redisChannel, subscriptionPromise);
  }

  private cleanupRedisSubscription(channelKey: string): void {
    const redisChannel = this.getRedisChannel(channelKey);

    const pendingSubscription = this.redisSubscriptionPromises.get(redisChannel);

    if (pendingSubscription) {
      pendingSubscription
        .then(() => {
          const activeSubscribers = this.channels.get(channelKey);

          if (activeSubscribers && activeSubscribers.size > 0) {
            return;
          }

          this.cleanupRedisSubscription(channelKey);
        })
        .catch(() => {
          // Error already logged in ensureRedisSubscription.
        });
      return;
    }

    if (!this.redisSubscribedChannels.has(redisChannel)) {
      return;
    }

    this.redisSubscribedChannels.delete(redisChannel);
    this.redisSubscriber.unsubscribe(redisChannel).catch((error) => {
      this.logger.warn(
        `Failed to unsubscribe from redis channel ${redisChannel}: ${error}`,
      );
    });
  }

  private handleRedisMessage(channel: string, rawPayload: string): void {
    const channelKey = this.extractChannelKey(channel);

    if (!channelKey) {
      this.logger.warn(`Received message for unknown channel: ${channel}`);
      return;
    }

    let envelope: NotificationEnvelope;

    try {
      envelope = JSON.parse(rawPayload) as NotificationEnvelope;
    } catch (error) {
      this.logger.warn(
        `Failed to parse notification payload from ${channel}: ${error}`,
      );
      return;
    }

    const subscribers = this.channels.get(channelKey);

    if (!subscribers || subscribers.size === 0) {
      return;
    }

    const message: MessageEvent = {
      type: envelope.event,
      data: envelope,
    };

    for (const subscriber of subscribers) {
      subscriber.next(message);
    }
  }

  private getChannelKey(target: NotificationTarget, targetId: string): string {
    return `${target}:${targetId}`;
  }

  private getRedisChannel(channelKey: string): string {
    return `notifications:${channelKey}`;
  }

  private async waitForRedisSubscription(channelKey: string): Promise<void> {
    const redisChannel = this.getRedisChannel(channelKey);
    const pendingSubscription = this.redisSubscriptionPromises.get(redisChannel);

    if (!pendingSubscription) {
      return;
    }

    try {
      await pendingSubscription;
    } catch (error) {
      this.logger.warn(
        `Redis subscription for ${redisChannel} failed before publishing: ${error}`,
      );
    }
  }

  private extractChannelKey(redisChannel: string): string | null {
    const prefix = 'notifications:';
    if (!redisChannel.startsWith(prefix)) {
      return null;
    }

    return redisChannel.slice(prefix.length);
  }
}
