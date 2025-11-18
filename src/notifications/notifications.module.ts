import { Module } from '@nestjs/common';
import { NotificationStreamModule } from '../gateway/notification-stream.module';

@Module({
  imports: [NotificationStreamModule],
  exports: [NotificationStreamModule],
})
export class NotificationsModule {}
