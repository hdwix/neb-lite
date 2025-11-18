import { Module } from '@nestjs/common';
import { RedisModule } from '../../infrastructure/redis/redis.module';
import { NotificationStreamAdapter } from './adapters/notification-stream.adapter';
import { NOTIFICATION_PUBLISHER } from '../domain/ports/notification-publisher.port';

@Module({
  imports: [RedisModule],
  providers: [
    NotificationStreamAdapter,
    {
      provide: NOTIFICATION_PUBLISHER,
      useExisting: NotificationStreamAdapter,
    },
  ],
  exports: [NOTIFICATION_PUBLISHER, NotificationStreamAdapter],
})
export class NotificationStreamModule {}
