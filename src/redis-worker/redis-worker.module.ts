import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullBoardModule } from '@bull-board/nestjs';
import { ExpressAdapter } from '@bull-board/express';
import { GatewayModule } from '../gateway/gateway.module';
import { LocationModule } from '../location/location.module';
import { RidesModule } from '../rides/rides.module';
import Redis from 'ioredis';
import { RedisModule } from '@nestjs-modules/ioredis';

@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        connection: {
          host: configService.get<string>('REDIS_HOST', 'localhost'),
          port: configService.get<number>('REDIS_PORT', 6379),
        },
      }),
    }),
    BullBoardModule.forRoot({
      route: '/queues',
      adapter: ExpressAdapter,
    }),
    // RedisModule.forRootAsync({
    //   imports: [ConfigModule],
    //   inject: [ConfigService],
    //   useFactory: async (configService: ConfigService) => {
    //     const host = configService.get<string>('REDIS_HOST');
    //     const port = configService.get<number>('REDIS_PORT');
    //     const password = configService.get<string>('REDIS_AUTH');

    //     const url = password
    //       ? `redis://:${password}@${host}:${port}`
    //       : `redis://${host}:${port}`;

    //     return {
    //       type: 'single',
    //       url,
    //     };
    //   },
    // }),
    GatewayModule,
    LocationModule,
    RidesModule,
  ],
})
export class RedisWorkerModule {}
