import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TripTrack } from '../../domain/entities/trip-track.entity';

@Injectable()
export class TripTrackRepository {
  constructor(
    @InjectRepository(TripTrack)
    private readonly repository: Repository<TripTrack>,
  ) {}

  create(data: Partial<TripTrack>): TripTrack {
    return this.repository.create(data);
  }

  async saveMany(entries: TripTrack[]): Promise<void> {
    if (entries.length === 0) {
      return;
    }

    await this.repository.save(entries);
  }
}
