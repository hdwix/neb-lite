import { InjectQueue } from '@nestjs/bullmq';
import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { Queue } from 'bullmq';
import { LOCATION_QUEUE_NAME } from './domain/services/location.types';

/**
 * LocationQueueMaintenanceService periodically clears historical BullMQ jobs
 * for the driver location queue. Without this task BullMQ would keep one Redis
 * key per completed job which, in our use case, maps to every location update
 * processed for every driver. The cleanup ensures that only the active queue
 * state is retained while long-term history is discarded, preventing Redis
 * memory from growing with each GPS ping.
 *
 * Why not create a dedicated BullMQ worker that enqueues "cleanup" jobs instead?
 * That approach is valid, but for this project we prefer the lightweight
 * in-process timer because the maintenance logic boils down to `queue.clean`
 * calls that run instantly and do not benefit from the retry/visibility model
 * BullMQ provides. A worker-based solution would introduce an additional queue
 * (or more jobs on the existing queue), extra Redis keys, and failure handling
 * semantics purely for the sake of triggering a single API call. By keeping the
 * task inside the NestJS process we reuse the same connection pool that already
 * exists for the app, run synchronously with application lifecycle hooks, and
 * avoid the operational overhead of another worker process.
 *
 * The trade-off is that a timer only runs while this service is alive. If the
 * application is scaled down to zero instances the pruning will pause, whereas a
 * standalone BullMQ worker could keep running independently. Additionally, very
 * large maintenance jobs could benefit from BullMQ's retry/delay controls. Those
 * characteristics are less relevant for the quick cleanup performed here, so we
 * choose the simpler timer-based strategy.
 */
@Injectable()
export class LocationQueueMaintenanceService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(LocationQueueMaintenanceService.name);
  private readonly cleanupIntervalMs = 60_000;
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor(
    @InjectQueue(LOCATION_QUEUE_NAME)
    private readonly locationQueue: Queue,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    // Run once at startup so we do not leave behind any jobs created before the
    // maintenance service kicked in.
    await this.pruneQueueHistory();
    this.startCleanupTimer();
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  private startCleanupTimer(): void {
    // Keep pruning every minute while the app is alive so history cannot pile
    // up during long-running sessions.
    this.cleanupTimer = setInterval(() => {
      void this.pruneQueueHistory();
    }, this.cleanupIntervalMs);
    this.cleanupTimer.unref?.();
  }

  private async pruneQueueHistory(): Promise<void> {
    try {
      // Immediately remove completed jobs and aggressively prune failed ones
      await this.locationQueue.clean(0, 'completed');
      await this.locationQueue.clean(24 * 60 * 60 * 1000, 'failed', 100);
    } catch (error) {
      this.logger.warn(`Unable to prune driver location jobs: ${error}`);
    }
  }
}
