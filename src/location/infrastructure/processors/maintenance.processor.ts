import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job } from 'bullmq';
import Redis from 'ioredis';
import {
  MAINTENANCE_CLEANUP_IDLE_DRIVERS,
  MaintenanceJob,
  THRESHOLD_DRIVER_IDLE_MS,
  ACTIVE_DRIVER_LOC_ZSET,
  CLEANUP_DRIVER_IDLE_LOC_BATCH,
  DRIVER_LOC_GEO_KEY,
  DRIVER_LOC_HASH_PREFIX,
  DRIVER_METADATA_HASH_KEY,
} from '../../domain/services/location.types';

@Processor(MAINTENANCE_CLEANUP_IDLE_DRIVERS)
export class MaintenanceProcessor extends WorkerHost {
  private readonly logger = new Logger(MaintenanceProcessor.name);
  private readonly redis: Redis;

  constructor(private readonly configService: ConfigService) {
    super();
    const host = this.configService.get<string>('REDIS_HOST', 'localhost');
    const port = this.configService.get<number>('REDIS_PORT', 6379);

    this.redis = new Redis({ host, port });
    this.redis.on('error', (error) =>
      this.logger.error(`Redis connection error: ${error}`),
    );
  }

  async process(job: Job): Promise<void> {
    if (job.name !== MaintenanceJob.CleanupIdleDrivers) return;

    const cutoff = Date.now() - THRESHOLD_DRIVER_IDLE_MS;

    // Paginate stale IDs to avoid huge transactions
    while (true) {
      const staleIds: string[] = await this.redis.zrangebyscore(
        ACTIVE_DRIVER_LOC_ZSET,
        0,
        cutoff,
        'LIMIT',
        0,
        CLEANUP_DRIVER_IDLE_LOC_BATCH,
      );

      if (staleIds.length === 0) break;

      const m = this.redis.multi();
      m.zrem(ACTIVE_DRIVER_LOC_ZSET, ...staleIds);
      m.zrem(DRIVER_LOC_GEO_KEY, ...staleIds);
      for (const id of staleIds) m.del(`${DRIVER_LOC_HASH_PREFIX}${id}`);
      m.hdel(DRIVER_METADATA_HASH_KEY, ...staleIds);
      await m.exec();

      if (staleIds.length < CLEANUP_DRIVER_IDLE_LOC_BATCH) break; // finished this pass
    }
  }
}
