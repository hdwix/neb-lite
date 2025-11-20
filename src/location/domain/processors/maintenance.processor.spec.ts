import { ConfigService } from '@nestjs/config';
import { MaintenanceProcessor } from './maintenance.processor';
import { MaintenanceJob } from '../services/location.types';

describe('MaintenanceProcessor', () => {
  const configService = {
    get: jest.fn().mockImplementation((key: string, fallback?: any) => {
      if (key === 'REDIS_HOST') return 'localhost';
      if (key === 'REDIS_PORT') return 6379;
      return fallback;
    }),
  } as unknown as ConfigService;

  const setupProcessor = () => {
    const processor = new MaintenanceProcessor(configService);
    const redis = (processor as any).redis as any;
    const zrangebyscore = redis.zrangebyscore as jest.Mock;
    const multi = redis.multi as jest.Mock;
    const exec = jest.fn().mockResolvedValue([]);

    multi.mockReturnValue({
      zrem: jest.fn().mockReturnThis(),
      del: jest.fn().mockReturnThis(),
      hdel: jest.fn().mockReturnThis(),
      exec,
    });

    return { processor, zrangebyscore };
  };

  it('cleans up stale drivers and stops when none left', async () => {
    const { processor, zrangebyscore } = setupProcessor();
    zrangebyscore
      .mockResolvedValueOnce(['id-1', 'id-2'])
      .mockResolvedValueOnce([]);

    await processor.process({ name: MaintenanceJob.CleanupIdleDrivers } as any);

    expect(zrangebyscore).toHaveBeenCalled();
  });

  it('skips non-cleanup jobs', async () => {
    const { processor, zrangebyscore } = setupProcessor();

    await processor.process({ name: 'other-job' } as any);

    expect(zrangebyscore).not.toHaveBeenCalled();
  });
});
