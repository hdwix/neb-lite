declare module 'bullmq' {
  export interface Job<Data = any> {
    name: string;
    data: Data;
  }

  export type QueueOptions = any;
  export type JobsOptions = any;
  export type RepeatOptions = any;

  export class Queue<DataType = any> {
    constructor(name?: string, options?: QueueOptions);
    add(name: string, data: DataType, options?: any): Promise<any>;
    getJob(id: string): Promise<any>;
    remove(id: string): Promise<void>;
    getJobSchedulers(): Promise<any[]>;
    removeJobScheduler(key: string): Promise<void>;
    name: string;
    opts: any;
  }

  export class QueueEvents {
    constructor(name: string, options?: any);
    waitUntilReady(): Promise<void>;
    close(): Promise<void>;
  }

  export class WorkerHost {
    process(job: Job): Promise<any>;
  }
}

declare module '@nestjs/bullmq' {
  import type { Queue } from 'bullmq';

  export function InjectQueue(queueName?: string): ParameterDecorator;
  export function Processor(queueName?: string, options?: any): ClassDecorator;
  export class BullModule {
    static registerQueue(..._args: any[]): any;
  }
  export class WorkerHost {
    process(job: any): Promise<any>;
  }
  export function getQueueToken(queueName?: string): string;
  export type RegisterQueueOptions = any;
}
