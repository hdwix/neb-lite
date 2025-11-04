import {
  Global,
  Inject,
  Injectable,
  Logger,
  Module,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { REDIS_CLIENT } from './redis.tokens';

@Injectable()
class RedisClientLifecycle implements OnModuleDestroy {
  private readonly logger = new Logger(RedisClientLifecycle.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redisClient: Redis) {
    this.redisClient.on('error', (error) =>
      this.logger.error(`Redis connection error: ${error.message ?? error}`),
    );
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.redisClient.quit();
    } catch (error) {
      this.logger.warn(`Failed to close redis connection: ${error}`);
    }
  }
}

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: REDIS_CLIENT,
      useFactory: (configService: ConfigService) => {
        const host = configService.get<string>('REDIS_HOST', 'localhost');
        const port = configService.get<number>('REDIS_PORT', 6379);
        const nodeEnv = configService.get<string>('NODE_ENV', 'dev');

        if (nodeEnv === 'production') {
          return new Redis.Cluster(
            [
              {
                host,
                port,
              },
            ],
            {
              redisOptions: {
                tls: {}, // Enables TLS
              },
            },
          );
        } else {
          return new Redis({ host, port });
        }
      },
      inject: [ConfigService],
    },
    RedisClientLifecycle,
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
