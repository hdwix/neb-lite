import { Module } from '@nestjs/common';
import { AppController } from './app/controllers/app.controller';
import { DatabaseModule } from './infrastructure/modules/database.module';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { IamModule } from './iam/iam.module';
import { RedisWorkerModule } from './redis-worker/redis-worker.module';
import KeyvRedis, { Keyv } from '@keyv/redis';
import { CacheModule } from '@nestjs/cache-manager';
import { LoggingModule } from './infrastructure/modules/logging.module';
import { GatewayModule } from './gateway/gateway.module';
import { HttpModule } from '@nestjs/axios';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: `.env` }),
    CacheModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => {
        const hostRedis = configService.get<string>('REDIS_HOST');
        const portRedis = configService.get<number>('REDIS_PORT');
        const redisUri = `redis://${hostRedis}:${portRedis}`;
        return {
          stores: [new KeyvRedis(redisUri)],
        };
      },
      isGlobal: true,
    }),
    DatabaseModule,
    IamModule,
    RedisWorkerModule,
    LoggingModule,
    GatewayModule,
    HttpModule,
  ],
  controllers: [AppController],
  providers: [],
})
export class NebengliteModule {}
