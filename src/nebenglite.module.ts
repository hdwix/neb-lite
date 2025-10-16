import { Module } from '@nestjs/common';
import { AppController } from './app/controllers/app.controller';
import { DatabaseModule } from './infrastructure/modules/database.module';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { IamModule } from './iam/iam.module';
import { RedisWorkerModule } from './redis-worker/redis-worker.module';
import { CacheModule } from '@nestjs/cache-manager';
import { LoggingModule } from './infrastructure/modules/logging.module';
import { GatewayModule } from './gateway/gateway.module';
import { HttpModule } from '@nestjs/axios';
import { LocationModule } from './location/location.module';
import Keyv from 'keyv';
import { RedisModule } from './redis/redis.module';
import { RedisService } from './redis/redis.service';
import { IoredisKeyvAdapter } from './redis/ioredis-keyv.adapter';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: `.env` }),
    CacheModule.registerAsync({
      imports: [ConfigModule, RedisModule],
      inject: [ConfigService, RedisService],
      useFactory: async (
        configService: ConfigService,
        redisService: RedisService,
      ) => {
        const namespace =
          configService.get<string>('CACHE_NAMESPACE') ?? 'cache';
        const ttl = configService.get<number>('CACHE_TTL_MS');
        const store = new IoredisKeyvAdapter(redisService.getClient());
        const keyv = new Keyv({
          store,
          namespace,
          ttl,
        });

        return {
          stores: [keyv],
        };
      },
      isGlobal: true,
    }),
    DatabaseModule,
    IamModule,
    RedisModule,
    RedisWorkerModule,
    LoggingModule,
    GatewayModule,
    HttpModule,
    LocationModule,
  ],
  controllers: [AppController],
  providers: [],
})
export class NebengliteModule {}
