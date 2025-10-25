import { Module } from '@nestjs/common';
import { ClientService } from './domain/services/client.service';

@Module({
  controllers: [],
  providers: [ClientService],
})
export class ClientModule {}
