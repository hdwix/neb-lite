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

  async claimDriver(rideId: string, driverId: string): Promise<boolean> {
    const result = await this.repository
      .createQueryBuilder()
      .update(Ride)
      .set({ driverId })
      .where('id = :rideId', { rideId })
      .andWhere('driver_id IS NULL')
      .execute();

    return Boolean(result.affected && result.affected > 0);
  }

  remove(ride: Ride): Promise<Ride> {
    return this.repository.remove(ride);
  }

  async findById(id: string): Promise<Ride | null> {
    return this.repository.findOne({
      where: { id },
      relations: ['candidates'],
      order: {
        candidates: { createdAt: 'ASC' },
      },
    });
  }
}
