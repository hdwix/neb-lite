import { Logger, MessageEvent } from '@nestjs/common';
import { NotificationStreamAdapter } from './notification-stream.adapter';
import { NotificationTarget } from '../../../notifications/domain/ports/notification-publisher.port';

class RedisMock {
  handlers: Record<string, (...args: any[]) => void> = {};
  publish = jest.fn<Promise<number>, any[]>().mockResolvedValue(1);
  subscribe = jest.fn<Promise<number>, any[]>().mockResolvedValue(1);
  unsubscribe = jest.fn<Promise<number>, any[]>().mockResolvedValue(1);
  quit = jest.fn<Promise<void>, any[]>().mockResolvedValue();
  on = jest.fn((event: string, handler: (...args: any[]) => void) => {
    this.handlers[event] = handler;
  });
  duplicate = jest.fn(() => new RedisMock());
}

describe('NotificationStreamAdapter', () => {
  let baseRedis: RedisMock;
  let redisPublisher: RedisMock;
  let redisSubscriber: RedisMock;
  let adapter: NotificationStreamAdapter;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'debug').mockImplementation(jest.fn());
    jest.spyOn(Logger.prototype, 'error').mockImplementation(jest.fn());
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(jest.fn());

    baseRedis = new RedisMock();
    const duplicateSpy = jest
      .spyOn(baseRedis, 'duplicate')
      .mockImplementation(() => new RedisMock());

    adapter = new NotificationStreamAdapter(baseRedis as any);
    redisPublisher = duplicateSpy.mock.results[0].value as RedisMock;
    redisSubscriber = duplicateSpy.mock.results[1].value as RedisMock;
  });

  const flushPromises = async () => new Promise(process.nextTick);

  it('registers subscribers and cleans up when they unsubscribe', async () => {
    const subscription = adapter.subscribe('driver', '1');
    await flushPromises();
    expect(redisSubscriber.subscribe).toHaveBeenCalledWith(
      'notifications:driver:1',
    );

    const subject = subscription.subscribe();
    subject.unsubscribe();
    await flushPromises();

    expect(redisSubscriber.unsubscribe).toHaveBeenCalledWith(
      'notifications:driver:1',
    );
  });

  it('avoids duplicate redis subscriptions when already pending or active', async () => {
    (adapter as any).ensureRedisSubscription('driver:1');
    expect(redisSubscriber.subscribe).toHaveBeenCalledTimes(1);

    (adapter as any).ensureRedisSubscription('driver:1');
    expect(redisSubscriber.subscribe).toHaveBeenCalledTimes(1);

    (adapter as any).redisSubscribedChannels.add('notifications:driver:1');
    (adapter as any).ensureRedisSubscription('driver:1');
    expect(redisSubscriber.subscribe).toHaveBeenCalledTimes(1);
  });

  it('delivers redis messages to subscribers', async () => {
    const subscription = adapter.subscribe('rider', '1');
    const messages: MessageEvent[] = [];
    const sub = subscription.subscribe((event) => messages.push(event));

    const envelope = {
      target: 'rider' as NotificationTarget,
      targetId: '1',
      event: 'update',
      payload: { hello: 'world' },
      timestamp: new Date().toISOString(),
    };

    (adapter as any).handleRedisMessage(
      'notifications:rider:1',
      JSON.stringify(envelope),
    );

    expect(messages).toEqual([
      {
        type: 'update',
        data: envelope,
      },
    ]);

    sub.unsubscribe();
  });

  it('logs warnings for unknown channels or invalid payloads', async () => {
    (adapter as any).handleRedisMessage('unknown:channel', '{}');
    expect(Logger.prototype.warn).toHaveBeenCalledWith(
      'Received message for unknown channel: unknown:channel',
    );

    (adapter as any).handleRedisMessage('notifications:rider:1', 'not-json');
    expect(Logger.prototype.warn).toHaveBeenCalledWith(
      expect.stringContaining('Failed to parse notification payload'),
    );

    (adapter as any).handleRedisMessage('notifications:rider:1', JSON.stringify({
      target: 'rider',
      targetId: '1',
      event: 'noop',
      payload: {},
      timestamp: new Date().toISOString(),
    }));
  });

  it('waits for subscription before publishing and returns false when no subscribers', async () => {
    const pending = Promise.resolve();
    (adapter as any).redisSubscriptionPromises.set(
      'notifications:driver:2',
      pending,
    );

    redisPublisher.publish.mockResolvedValue(0);
    const result = await adapter.emit('driver', '2', 'evt', {});
    expect(redisPublisher.publish).toHaveBeenCalledWith(
      'notifications:driver:2',
      expect.any(String),
    );
    expect(result).toBe(false);
  });

  it('returns false and logs error when publish fails', async () => {
    redisPublisher.publish.mockRejectedValue(new Error('publish failed'));
    const success = await adapter.emit('driver', '3', 'evt', {});
    expect(success).toBe(false);
    expect(Logger.prototype.error).toHaveBeenCalledWith(
      expect.stringContaining('Failed to publish evt notification'),
    );
  });

  it('logs warning when subscription promise rejects before publish', async () => {
    (adapter as any).redisSubscriptionPromises.set(
      'notifications:driver:4',
      Promise.reject('boom'),
    );

    await adapter.emit('driver', '4', 'evt', {});
    expect(Logger.prototype.warn).toHaveBeenCalledWith(
      'Redis subscription for notifications:driver:4 failed before publishing: boom',
    );
  });

  it('handles subscription errors and pending subscription cleanup', async () => {
    redisSubscriber.subscribe.mockRejectedValueOnce(new Error('sub fail'));

    (adapter as any).ensureRedisSubscription('driver:5');
    await expect(
      (adapter as any).redisSubscriptionPromises.get('notifications:driver:5'),
    ).rejects.toThrow('sub fail');
    expect(Logger.prototype.error).toHaveBeenCalledWith(
      'Failed to subscribe to redis channel notifications:driver:5: Error: sub fail',
    );
  });

  it('closes redis connections and logs warnings on failure', async () => {
    redisSubscriber.quit.mockRejectedValueOnce('fail-sub');
    redisPublisher.quit.mockRejectedValueOnce('fail-pub');

    await adapter.onModuleDestroy();
    expect(Logger.prototype.warn).toHaveBeenCalledWith(
      'Failed to close redis subscriber connection: fail-sub',
    );
    expect(Logger.prototype.warn).toHaveBeenCalledWith(
      'Failed to close redis publisher connection: fail-pub',
    );
  });
});
