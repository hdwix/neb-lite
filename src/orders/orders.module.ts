import { Module } from '@nestjs/common';
import { OrdersController } from './app/controllers/orders.controller';
import { OrdersService } from './domain/services/orders.service';

@Module({
  controllers: [OrdersController],
  providers: [OrdersService],
})
export class OrdersModule {}
