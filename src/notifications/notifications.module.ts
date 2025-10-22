import { Module } from '@nestjs/common';
import { NotificationStreamService } from './domain/services/notification-stream.service';

@Module({
  providers: [NotificationStreamService],
  exports: [NotificationStreamService],
})
export class NotificationsModule {}
