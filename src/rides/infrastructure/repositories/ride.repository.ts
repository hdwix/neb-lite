import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Ride } from '../../domain/entities/ride.entity';

@Injectable()
export class RideRepository {
  constructor(
    @InjectRepository(Ride)
    private readonly repository: Repository<Ride>,
  ) {}

  create(data: Partial<Ride>): Ride {
    return this.repository.create(data);
  }

  save(ride: Ride): Promise<Ride> {
    return this.repository.save(ride);
  }

  async findById(id: string): Promise<Ride | null> {
    return this.repository.findOne({ where: { id } });
  }
}
