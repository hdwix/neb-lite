import { RegisterQueueOptions } from '@nestjs/bullmq';
import { QueueOptions } from 'bullmq';

export type QueueRegistrationOptions = RegisterQueueOptions & {
  limiter?: QueueLimiterOptions;
};

export type QueueLimiterOptions = QueueOptions extends {
  limiter: infer Limiter;
}
  ? NonNullable<Limiter>
  : {
      max: number;
      duration: number;
      reservoir?: number;
      reservoirRefreshAmount?: number;
      reservoirRefreshInterval?: number;
    };
