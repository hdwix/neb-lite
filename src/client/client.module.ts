import { Module } from '@nestjs/common';
import { ClientController } from './app/controllers/client.controller';
import { ClientService } from './domain/services/client.service';

@Module({
  controllers: [ClientController],
  providers: [ClientService],
})
export class ClientModule {}
