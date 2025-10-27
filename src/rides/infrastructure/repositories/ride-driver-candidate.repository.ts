import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RideDriverCandidate } from '../../domain/entities/ride-driver-candidate.entity';

@Injectable()
export class RideDriverCandidateRepository {
  constructor(
    @InjectRepository(RideDriverCandidate)
    private readonly repository: Repository<RideDriverCandidate>,
  ) {}

  create(data: Partial<RideDriverCandidate>): RideDriverCandidate {
    return this.repository.create(data);
  }

  async save(
    candidate: RideDriverCandidate,
  ): Promise<RideDriverCandidate> {
    return this.repository.save(candidate);
  }

  async saveMany(
    candidates: RideDriverCandidate[],
  ): Promise<RideDriverCandidate[]> {
    return this.repository.save(candidates);
  }

  async findByRideId(rideId: string): Promise<RideDriverCandidate[]> {
    return this.repository.find({
      where: { rideId },
      order: { createdAt: 'ASC' },
    });
  }

  async findByRideAndDriver(
    rideId: string,
    driverId: string,
  ): Promise<RideDriverCandidate | null> {
    return this.repository.findOne({ where: { rideId, driverId } });
  }
}
