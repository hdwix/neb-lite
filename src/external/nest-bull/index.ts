import 'reflect-metadata';
import { DynamicModule, Inject, ModuleMetadata, Provider, Type } from '@nestjs/common';
import { randomUUID } from 'crypto';

export interface BullModuleOptions {
  name: string;
}

export interface BullRootModuleOptions {}

export interface BullModuleAsyncOptions
  extends Pick<ModuleMetadata, 'imports'> {
  useFactory?: (...args: unknown[]) => Promise<BullRootModuleOptions> | BullRootModuleOptions;
  inject?: Array<Type<unknown> | string | symbol>;
}

export interface Job<DataType = any> {
  id: string;
  name: string;
  data: DataType;
  timestamp: number;
  attemptsMade: number;
}

export interface QueueAddOptions {
  removeOnComplete?: boolean;
  removeOnFail?: boolean;
}

export interface Queue<DataType = any> {
  readonly name: string;
  add(jobName: string, data: DataType, opts?: QueueAddOptions): Promise<Job<DataType>>;
}

type QueueHandler<DataType = any> = {
  handler: (job: Job<DataType>) => Promise<void> | void;
  concurrency: number;
  active: number;
  queue: Job<DataType>[];
};

const queueStore = new Map<string, SimpleQueue<any>>();
const PROCESS_METADATA = Symbol('PROCESS_METADATA');

interface ProcessMetadataEntry {
  methodName: string | symbol;
  jobName: string;
  concurrency: number;
}

class SimpleQueue<DataType = any> implements Queue<DataType> {
  private handlers = new Map<string, QueueHandler<DataType>>();
  private pendingJobs = new Map<string, Job<DataType>[]>();

  constructor(public readonly name: string) {}

  registerProcessor(
    jobName: string,
    handler: QueueHandler<DataType>['handler'],
    concurrency = 1,
  ): void {
    const existing = this.handlers.get(jobName);
    if (existing) {
      existing.handler = handler;
      existing.concurrency = Math.max(1, concurrency);
      return;
    }
    this.handlers.set(jobName, {
      handler,
      concurrency: Math.max(1, concurrency),
      active: 0,
      queue: [],
    });

    const pending = this.pendingJobs.get(jobName) ?? [];
    if (pending.length > 0) {
      this.pendingJobs.delete(jobName);
      for (const job of pending) {
        this.enqueueJob(this.handlers.get(jobName)!, jobName, job);
      }
    }
  }

  async add(jobName: string, data: DataType): Promise<Job<DataType>> {
    const job: Job<DataType> = {
      id: randomUUID(),
      name: jobName,
      data,
      attemptsMade: 0,
      timestamp: Date.now(),
    };

    const handler = this.handlers.get(jobName);
    if (!handler) {
      const pending = this.pendingJobs.get(jobName) ?? [];
      pending.push(job);
      this.pendingJobs.set(jobName, pending);
      return job;
    }

    this.enqueueJob(handler, jobName, job);
    return job;
  }

  private enqueueJob(
    handler: QueueHandler<DataType>,
    jobName: string,
    job: Job<DataType>,
  ): void {
    handler.queue.push(job);
    this.tryProcess(handler, jobName);
  }

  private tryProcess(handler: QueueHandler<DataType>, jobName: string): void {
    while (handler.active < handler.concurrency && handler.queue.length > 0) {
      const job = handler.queue.shift();
      if (!job) {
        return;
      }
      handler.active += 1;
      Promise.resolve()
        .then(() => handler.handler(job))
        .catch(() => {
          // Swallow errors to keep queue running; real Bull would emit events.
        })
        .finally(() => {
          handler.active -= 1;
          this.tryProcess(handler, jobName);
        });
    }
  }
}

function getOrCreateQueue<DataType = any>(name: string): SimpleQueue<DataType> {
  const existing = queueStore.get(name);
  if (existing) {
    return existing;
  }
  const queue = new SimpleQueue<DataType>(name);
  queueStore.set(name, queue);
  return queue;
}

export function getQueueToken(name: string): string {
  return `BullQueue_${name}`;
}

export function InjectQueue(name: string): ParameterDecorator {
  return Inject(getQueueToken(name));
}

export function Process(
  options: string | { name: string; concurrency?: number },
): MethodDecorator {
  const jobName = typeof options === 'string' ? options : options.name;
  const concurrency = typeof options === 'string' ? 1 : options.concurrency ?? 1;

  return (target, propertyKey, descriptor) => {
    const constructor = target.constructor;
    const existing: ProcessMetadataEntry[] =
      Reflect.getMetadata(PROCESS_METADATA, constructor) ?? [];
    existing.push({
      methodName: propertyKey,
      jobName,
      concurrency,
    });
    Reflect.defineMetadata(PROCESS_METADATA, existing, constructor);
    return descriptor;
  };
}

export function Processor(queueName: string): ClassDecorator {
  return (target) => {
    const original = (target as unknown as { prototype: Record<string, any> }).prototype
      .onModuleInit;

    (target as unknown as { prototype: Record<string, any> }).prototype.onModuleInit =
      async function () {
        const queue = getOrCreateQueue(queueName);
        const handlers: ProcessMetadataEntry[] =
          Reflect.getMetadata(PROCESS_METADATA, target) ?? [];
        for (const handlerMeta of handlers) {
          const handler = Reflect.get(this, handlerMeta.methodName);
          if (typeof handler === 'function') {
            queue.registerProcessor(
              handlerMeta.jobName,
              handler.bind(this),
              handlerMeta.concurrency,
            );
          }
        }
        if (typeof original === 'function') {
          await original.apply(this);
        }
      };
  };
}

function createQueueProviders(options: BullModuleOptions[]): Provider[] {
  return options.map(({ name }) => ({
    provide: getQueueToken(name),
    useFactory: () => getOrCreateQueue(name),
  }));
}

export class BullModule {
  static forRootAsync(options: BullModuleAsyncOptions = {}): DynamicModule {
    const providers: Provider[] = [];
    if (options.useFactory) {
      providers.push({
        provide: 'BULL_ROOT_OPTIONS',
        useFactory: options.useFactory,
        inject: options.inject ?? [],
      });
    }

    return {
      module: BullModule,
      imports: options.imports ?? [],
      providers,
      exports: [],
    };
  }

  static registerQueue(...options: BullModuleOptions[]): DynamicModule {
    const providers = createQueueProviders(options);
    return {
      module: BullModule,
      providers,
      exports: providers,
    };
  }
}

