import type { QueueOptions } from 'bullmq';

type QueueLimiterOptions = QueueOptions extends { limiter: infer Limiter }
  ? NonNullable<Limiter>
  : {
      max: number;
      duration: number;
      reservoir?: number;
      reservoirRefreshAmount?: number;
      reservoirRefreshInterval?: number;
    };

export const ROUTE_ESTIMATION_QUEUE_LIMITER: QueueLimiterOptions = {
  max: 20,
  duration: 60_000,
  reservoir: 1000,
  reservoirRefreshAmount: 1000,
  reservoirRefreshInterval: 86_400_000,
};
