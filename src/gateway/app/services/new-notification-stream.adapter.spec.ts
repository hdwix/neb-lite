import { MessageEvent } from '@nestjs/common';
import Redis from 'ioredis';
import { NotificationStreamAdapter } from './notification-stream.adapter';

interface RedisConnectionMock {
  on: jest.Mock;
  publish: jest.Mock;
  subscribe: jest.Mock;
  unsubscribe: jest.Mock;
  quit: jest.Mock;
  emit: (event: string, ...args: any[]) => void;
}

const createRedisMocks = () => {
  const createConnection = (): RedisConnectionMock => {
    const handlers = new Map<string, (...args: any[]) => void>();
    const connection: RedisConnectionMock = {
      on: jest.fn((event: string, handler: (...args: any[]) => void) => {
        handlers.set(event, handler);
        return connection;
      }),
      publish: jest.fn().mockResolvedValue(1),
      subscribe: jest.fn().mockResolvedValue(1),
      unsubscribe: jest.fn().mockResolvedValue(1),
      quit: jest.fn().mockResolvedValue(undefined),
      emit: (event: string, ...args: any[]) => {
        const handler = handlers.get(event);
        handler?.(...args);
      },
    };

    return connection;
  };

  const publisher = createConnection();
  const subscriber = createConnection();

  const redisClient = {
    duplicate: jest
      .fn()
      .mockReturnValueOnce(publisher as unknown as Redis)
      .mockReturnValueOnce(subscriber as unknown as Redis),
  } as unknown as Redis & { duplicate: jest.Mock };

  return { redisClient, publisher, subscriber };
};

describe('NotificationStreamAdapter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('delivers redis messages to SSE subscribers', async () => {
    const { redisClient, subscriber } = createRedisMocks();
    const adapter = new NotificationStreamAdapter(redisClient);

    const received: MessageEvent[] = [];
    const subscription = adapter
      .subscribe('driver', 'driver-1')
      .subscribe((message) => received.push(message));

    await Promise.resolve();
    await Promise.resolve();

    const envelope = {
      target: 'driver' as const,
      targetId: 'driver-1',
      event: 'ride-updated',
      payload: { status: 'started' },
      timestamp: new Date().toISOString(),
    };

    subscriber.emit(
      'message',
      'notifications:driver:driver-1',
      JSON.stringify(envelope),
    );

    expect(received).toEqual([
      {
        type: envelope.event,
        data: envelope,
      },
    ]);

    subscription.unsubscribe();
  });

  it('cleans up redis subscription when the last subscriber disconnects', async () => {
    const { redisClient, subscriber } = createRedisMocks();
    const adapter = new NotificationStreamAdapter(redisClient);

    const subscription = adapter.subscribe('rider', 'rider-1').subscribe();

    const pendingSubscription = (adapter as any).redisSubscriptionPromises.get(
      'notifications:rider:rider-1',
    );

    await pendingSubscription;

    subscription.unsubscribe();

    await Promise.resolve();

    expect(subscriber.unsubscribe).toHaveBeenCalledWith(
      'notifications:rider:rider-1',
    );
  });

  it('returns false when publishing to redis yields no subscribers', async () => {
    const { redisClient, publisher } = createRedisMocks();
    publisher.publish.mockResolvedValueOnce(0);
    const adapter = new NotificationStreamAdapter(redisClient);

    const result = await adapter.emit('driver', 'driver-2', 'ride-finished', {
      rideId: 'ride-1',
    });

    expect(result).toBe(false);
  });

  it('logs and recovers from malformed redis messages', async () => {
    const { redisClient, subscriber } = createRedisMocks();
    const adapter = new NotificationStreamAdapter(redisClient);

    const logSpy = jest.spyOn((adapter as any).logger, 'log');
    const errorSpy = jest.spyOn((adapter as any).logger, 'error');

    subscriber.emit('message', 'unknown-channel', 'irrelevant');
    subscriber.emit('message', 'notifications:driver:123', '{invalid json');

    expect(logSpy).toHaveBeenCalledWith(
      'Received message for unknown channel: unknown-channel',
    );
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to parse notification payload'),
    );
  });

  it('logs redis connection errors from publisher and subscriber', () => {
    const { redisClient, publisher, subscriber } = createRedisMocks();
    const adapter = new NotificationStreamAdapter(redisClient);

    const errorSpy = jest.spyOn((adapter as any).logger, 'error');

    const publisherError = new Error('publisher boom');
    const subscriberError = new Error('subscriber boom');

    publisher.emit('error', publisherError);
    subscriber.emit('error', subscriberError);

    expect(errorSpy).toHaveBeenCalledWith(
      'Redis connection error: publisher boom',
    );
    expect(errorSpy).toHaveBeenCalledWith(
      'Redis connection error: subscriber boom',
    );
  });

  it('logs redis connection errors even when error message is missing', () => {
    const { redisClient, publisher } = createRedisMocks();
    const adapter = new NotificationStreamAdapter(redisClient);

    const errorSpy = jest.spyOn((adapter as any).logger, 'error');

    publisher.emit('error', { toString: () => 'mystery error' } as any);

    expect(errorSpy).toHaveBeenCalledWith(
      'Redis connection error: mystery error',
    );
  });

  it('awaits pending redis subscription failures before publishing', async () => {
    const { redisClient, subscriber, publisher } = createRedisMocks();
    const adapter = new NotificationStreamAdapter(redisClient);

    subscriber.subscribe.mockReturnValueOnce(
      Promise.reject(new Error('subscription failed')),
    );

    adapter.subscribe('driver', 'driver-3').subscribe();

    const errorSpy = jest.spyOn((adapter as any).logger, 'error');

    const result = await adapter.emit('driver', 'driver-3', 'ride-update', {
      rideId: 'ride-3',
    });

    expect(publisher.publish).toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        'Redis subscription for notifications:driver:driver-3 failed before publishing: Error: subscription failed',
      ),
    );
    expect(result).toBe(true);
  });

  it('handles failures when publishing notifications', async () => {
    const { redisClient, publisher } = createRedisMocks();
    const adapter = new NotificationStreamAdapter(redisClient);

    publisher.publish.mockRejectedValueOnce(new Error('publish failed'));
    const errorSpy = jest.spyOn((adapter as any).logger, 'error');

    const result = await adapter.emit('driver', 'driver-4', 'ride-update', {
      rideId: 'ride-4',
    });

    expect(result).toBe(false);
    expect(errorSpy).toHaveBeenCalledWith(
      'Failed to publish ride-update notification for driver:driver-4: Error: publish failed',
    );
  });

  it('attempts to close redis connections on module destroy', async () => {
    const { redisClient, publisher, subscriber } = createRedisMocks();
    const adapter = new NotificationStreamAdapter(redisClient);

    subscriber.quit.mockRejectedValueOnce(new Error('quit failed'));
    publisher.quit.mockRejectedValueOnce(new Error('publisher quit failed'));

    const errorSpy = jest.spyOn((adapter as any).logger, 'error');

    await adapter.onModuleDestroy();

    expect(subscriber.quit).toHaveBeenCalled();
    expect(publisher.quit).toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      'Failed to close redis subscriber connection: Error: quit failed',
    );
    expect(errorSpy).toHaveBeenCalledWith(
      'Failed to close redis publisher connection: Error: publisher quit failed',
    );
  });

  it('ignores finalize cleanup when subscribers map is missing', () => {
    const { redisClient } = createRedisMocks();
    const adapter = new NotificationStreamAdapter(redisClient);

    const cleanupSpy = jest.spyOn<any, any>(
      adapter as any,
      'cleanupRedisSubscription',
    );
    const subscription = adapter.subscribe('driver', 'driver-5').subscribe();

    (adapter as any).channels.delete('driver:driver-5');

    subscription.unsubscribe();

    expect(cleanupSpy).not.toHaveBeenCalled();
  });

  it('logs disconnect message when subscribers unsubscribe', () => {
    const { redisClient } = createRedisMocks();
    const adapter = new NotificationStreamAdapter(redisClient);

    const logSpy = jest.spyOn((adapter as any).logger, 'log');

    const subscription = adapter.subscribe('driver', 'driver-12').subscribe();

    subscription.unsubscribe();

    expect(logSpy).toHaveBeenCalledWith(
      'SSE subscriber disconnected from driver:driver-12. Remaining connections: 0',
    );
  });

  it('logs disconnect message with default count when subscriber size is missing', () => {
    const { redisClient } = createRedisMocks();
    const adapter = new NotificationStreamAdapter(redisClient);

    const logSpy = jest.spyOn((adapter as any).logger, 'log');

    const subscription = adapter.subscribe('driver', 'driver-13').subscribe();

    const stubSubscribers = {
      delete: jest.fn(),
    } as any;

    (adapter as any).channels.set('driver:driver-13', stubSubscribers);

    subscription.unsubscribe();

    expect(stubSubscribers.delete).toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(
      'SSE subscriber disconnected from driver:driver-13. Remaining connections: 0',
    );
  });

  it('avoids duplicate redis subscriptions when one is pending', () => {
    const { redisClient, subscriber } = createRedisMocks();
    const adapter = new NotificationStreamAdapter(redisClient);

    subscriber.subscribe.mockReturnValueOnce(new Promise(() => {}));

    (adapter as any).ensureRedisSubscription('driver:driver-6');
    (adapter as any).ensureRedisSubscription('driver:driver-6');

    expect(subscriber.subscribe).toHaveBeenCalledTimes(1);
  });

  it('retains redis subscription when pending and subscribers remain active', async () => {
    const { redisClient, subscriber } = createRedisMocks();
    const adapter = new NotificationStreamAdapter(redisClient);

    let resolveSubscription: (() => void) | undefined;
    const deferred = new Promise<void>((resolve) => {
      resolveSubscription = resolve;
    });
    subscriber.subscribe.mockReturnValueOnce(deferred);

    const subscription = adapter.subscribe('driver', 'driver-7').subscribe();

    const pendingSubscription = (adapter as any).redisSubscriptionPromises.get(
      'notifications:driver:driver-7',
    );

    (adapter as any).cleanupRedisSubscription('driver:driver-7');

    resolveSubscription?.();
    await pendingSubscription;

    expect(subscriber.unsubscribe).not.toHaveBeenCalled();

    subscription.unsubscribe();
  });

  it('logs errors when pending redis subscription rejects during cleanup', async () => {
    const { redisClient } = createRedisMocks();
    const adapter = new NotificationStreamAdapter(redisClient);

    let rejectSubscription: ((reason?: any) => void) | undefined;
    const deferred = new Promise<void>((_, reject) => {
      rejectSubscription = reject;
    });

    (adapter as any).redisSubscriptionPromises.set(
      'notifications:driver:driver-8',
      deferred,
    );

    const errorSpy = jest.spyOn((adapter as any).logger, 'error');

    (adapter as any).cleanupRedisSubscription('driver:driver-8');

    rejectSubscription?.(new Error('subscription rejected'));
    await deferred.catch(() => undefined);

    expect(errorSpy).toHaveBeenCalledWith(
      'Error already logged in ensureRedisSubscription',
    );
  });

  it('skips unsubscribe when redis channel was never subscribed', () => {
    const { redisClient, subscriber } = createRedisMocks();
    const adapter = new NotificationStreamAdapter(redisClient);

    (adapter as any).cleanupRedisSubscription('driver:driver-9');

    expect(subscriber.unsubscribe).not.toHaveBeenCalled();
  });

  it('logs unsubscribe failures when redis unsubscribe rejects', async () => {
    const { redisClient, subscriber } = createRedisMocks();
    const adapter = new NotificationStreamAdapter(redisClient);

    (adapter as any).redisSubscribedChannels.add(
      'notifications:driver:driver-10',
    );
    subscriber.unsubscribe.mockRejectedValueOnce(new Error('unsub failed'));

    const logSpy = jest.spyOn((adapter as any).logger, 'log');

    (adapter as any).cleanupRedisSubscription('driver:driver-10');

    await Promise.resolve();

    expect(logSpy).toHaveBeenCalledWith(
      'Failed to unsubscribe from redis channel notifications:driver:driver-10: Error: unsub failed',
    );
  });

  it('returns early when redis messages arrive with no active subscribers', () => {
    const { redisClient } = createRedisMocks();
    const adapter = new NotificationStreamAdapter(redisClient);

    const envelope = {
      target: 'driver' as const,
      targetId: 'driver-11',
      event: 'ride-update',
      payload: { rideId: 'ride-11' },
      timestamp: new Date().toISOString(),
    };

    expect(() =>
      (adapter as any).handleRedisMessage(
        'notifications:driver:driver-11',
        JSON.stringify(envelope),
      ),
    ).not.toThrow();
  });
});
