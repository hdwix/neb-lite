jest.mock(
  '@nestjs/axios',
  () => ({
    HttpService: class {
      post = jest.fn();
    },
  }),
  { virtual: true },
);

jest.mock(
  'bullmq',
  () => {
    class MockQueue {
      constructor(public name: string = 'queue') {}
      add = jest.fn(async (_name: string, _data: any, _opts?: any) => ({
        id: 'job-id',
      }));
      getJob = jest.fn(async (_jobId: string) => null);
      remove = jest.fn(async (_jobId: string) => undefined);
      opts = { connection: {} };
      getJobSchedulers = jest.fn(async () => []);
      removeJobScheduler = jest.fn(async (_key: string) => undefined);
    }

    class MockQueueEvents {
      constructor(public name: string, public opts?: any) {}
      waitUntilReady = jest.fn(async () => undefined);
      close = jest.fn(async () => undefined);
    }

    class MockWorkerHost {
      async process(_job: any): Promise<void> {}
    }

    return {
      Queue: MockQueue,
      QueueEvents: MockQueueEvents,
      WorkerHost: MockWorkerHost,
    };
  },
  { virtual: true },
);

jest.mock(
  'ioredis',
  () => {
    class MockRedis {
      on = jest.fn();
      zrangebyscore = jest.fn();
      zmscore = jest.fn();
      geoadd = jest.fn();
      georadius = jest.fn();
      hset = jest.fn();
      expire = jest.fn();
      zadd = jest.fn();
      publish = jest.fn();
      hgetall = jest.fn();
      quit = jest.fn();
      multi = jest.fn().mockReturnValue({
        zrem: jest.fn().mockReturnThis(),
        del: jest.fn().mockReturnThis(),
        hdel: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([]),
      });
    }

    return { __esModule: true, default: MockRedis };
  },
  { virtual: true },
);

jest.mock(
  '@nestjs/bullmq',
  () => ({
    InjectQueue: () => () => undefined,
    Processor: () => () => undefined,
    WorkerHost: class {
      async process(_job: any): Promise<void> {}
    },
    getQueueToken: (name?: string) => name ?? 'default',
  }),
  { virtual: true },
);

jest.mock(
  'ulid',
  () => ({
    monotonicFactory: () => () => 'mock-ulid',
    ulid: () => 'mock-ulid',
  }),
  { virtual: true },
);
