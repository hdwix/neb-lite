import { EventEmitter } from 'events';
import type { KeyvStoreAdapter, StoredData } from 'keyv';
import Redis from 'ioredis';

export class IoredisKeyvAdapter
  extends EventEmitter
  implements KeyvStoreAdapter
{
  public opts: { namespace?: string; dialect: string };

  private namespaceValue?: string;

  constructor(private readonly redis: Redis) {
    super();
    this.opts = { dialect: 'redis' };
    this.redis.on('error', (error) => this.emit('error', error));
  }

  get namespace(): string | undefined {
    return this.namespaceValue;
  }

  set namespace(value: string | undefined) {
    this.namespaceValue = value;
    this.opts.namespace = value;
  }

  async get<Value>(key: string): Promise<StoredData<Value> | undefined> {
    const value = await this.redis.get(key);
    return (value ?? undefined) as StoredData<Value> | undefined;
  }

  async set(key: string, value: any, ttl?: number): Promise<void> {
    if (typeof ttl === 'number') {
      await this.redis.set(key, value, 'PX', ttl);
    } else {
      await this.redis.set(key, value);
    }
  }

  async setMany(
    values: Array<{ key: string; value: any; ttl?: number }>,
  ): Promise<void> {
    if (values.length === 0) {
      return;
    }

    const pipeline = this.redis.pipeline();
    for (const { key, value, ttl } of values) {
      if (typeof ttl === 'number') {
        pipeline.set(key, value, 'PX', ttl);
      } else {
        pipeline.set(key, value);
      }
    }

    await pipeline.exec();
  }

  async delete(key: string): Promise<boolean> {
    return (await this.redis.del(key)) > 0;
  }

  async deleteMany(keys: string[]): Promise<boolean> {
    if (keys.length === 0) {
      return false;
    }

    return (await this.redis.del(keys)) > 0;
  }

  async clear(): Promise<void> {
    const keys = await this.collectKeys();
    if (keys.length === 0) {
      return;
    }

    await this.redis.del(keys);
  }

  async getMany<Value>(keys: string[]): Promise<Array<StoredData<Value>>> {
    if (keys.length === 0) {
      return [];
    }

    const values = await this.redis.mget(keys);
    return values.map((value) => (value ?? undefined) as StoredData<Value>);
  }

  async disconnect(): Promise<void> {
    // No-op. The underlying Redis connection is managed externally.
  }

  private async collectKeys(): Promise<string[]> {
    const pattern = this.namespaceValue ? `${this.namespaceValue}:*` : '*';
    const keys: string[] = [];
    let cursor = '0';

    do {
      const [nextCursor, batch] = await this.redis.scan(
        cursor,
        'MATCH',
        pattern,
        'COUNT',
        100,
      );
      cursor = nextCursor;
      keys.push(...batch);
    } while (cursor !== '0');

    return keys;
  }
}
