import { Queue } from 'bullmq';
import { MaintenanceSchedulerService } from './maintenance-scheduler.service';
import {
  MAINTENANCE_CLEANUP_IDLE_DRIVERS,
  MaintenanceJob,
} from './location.types';

describe('MaintenanceSchedulerService', () => {
  it('schedules repeatable cleanup job on init', async () => {
    const add = jest.fn();
    const maintenanceQueue = { add } as unknown as Queue;
    const scheduler = new MaintenanceSchedulerService(maintenanceQueue);

    await scheduler.onModuleInit();

    expect(add).toHaveBeenCalledWith(
      MaintenanceJob.CleanupIdleDrivers,
      {},
      {
        jobId: MaintenanceJob.CleanupIdleDrivers,
        repeat: { every: expect.any(Number) },
        removeOnComplete: { count: 10 },
      },
    );
  });
});
