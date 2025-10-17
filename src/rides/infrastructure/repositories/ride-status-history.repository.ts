import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RideStatusHistory } from '../../domain/entities/ride-status-history.entity';

@Injectable()
export class RideStatusHistoryRepository {
  constructor(
    @InjectRepository(RideStatusHistory)
    private readonly repository: Repository<RideStatusHistory>,
  ) {}

  create(data: Partial<RideStatusHistory>): RideStatusHistory {
    return this.repository.create(data);
  }

  save(entity: RideStatusHistory): Promise<RideStatusHistory> {
    return this.repository.save(entity);
  }
}
