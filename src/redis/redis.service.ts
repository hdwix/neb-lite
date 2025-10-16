import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis, { RedisOptions } from 'ioredis';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly client: Redis;
  private readonly managedClients = new Set<Redis>();

  constructor(private readonly configService: ConfigService) {
    const host = this.configService.get<string>('REDIS_HOST', 'localhost');
    const port = this.configService.get<number>('REDIS_PORT', 6379);

    this.client = new Redis({ host, port });
    this.registerErrorLogger(this.client);
  }

  getClient(): Redis {
    return this.client;
  }

  createClient(options?: RedisOptions): Redis {
    const client = options
      ? new Redis(options)
      : this.client.duplicate();

    this.registerErrorLogger(client);
    client.once('end', () => this.managedClients.delete(client));
    client.once('close', () => this.managedClients.delete(client));
    this.managedClients.add(client);

    return client;
  }

  private registerErrorLogger(client: Redis): void {
    client.on('error', (error) =>
      this.logger.error(`Redis connection error: ${error}`),
    );
  }

  async onModuleDestroy(): Promise<void> {
    for (const client of this.managedClients) {
      if (client.status === 'end' || client.status === 'close') {
        continue;
      }
      try {
        await client.quit();
      } catch (error) {
        this.logger.warn(`Failed to close managed redis connection: ${error}`);
      }
    }

    this.managedClients.clear();

    if (this.client.status !== 'end' && this.client.status !== 'close') {
      try {
        await this.client.quit();
      } catch (error) {
        this.logger.warn(`Failed to close redis connection: ${error}`);
      }
    }
  }
}
