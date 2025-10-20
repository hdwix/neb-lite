import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  ACTIVE_DRIVER_LOC_ZSET,
  CLEANUP_DRIVER_IDLE_LOC_BATCH,
  DRIVER_LOC_GEO_KEY,
  DRIVER_LOC_HASH_PREFIX,
  JOB_CLEANUP_IDLE_LOC_EVERY_MS,
  MAINTENANCE_CLEANUP_IDLE_DRIVERS,
  MaintenanceJob,
  THRESHOLD_DRIVER_IDLE_MS,
} from './location.types';
import { Job, Queue } from 'bullmq';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import Redis from 'ioredis';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class MaintenanceSchedulerService {
  constructor(
    @InjectQueue(MAINTENANCE_CLEANUP_IDLE_DRIVERS)
    private readonly maintenanceQueue: Queue,
  ) {}

  async onModuleInit(): Promise<void> {
    // Ensure exactly one repeatable job exists (idempotent via jobId)
    await this.maintenanceQueue.add(
      MaintenanceJob.CleanupIdleDrivers,
      {}, // no payload needed
      {
        jobId: MaintenanceJob.CleanupIdleDrivers,
        repeat: { every: JOB_CLEANUP_IDLE_LOC_EVERY_MS }, // run every minute
        removeOnComplete: { count: 10 },
      },
    );
  }
}
