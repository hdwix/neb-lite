import { QueueOptions } from 'bullmq';

export const ROUTE_ESTIMATION_QUEUE_LIMITER: NonNullable<
  QueueOptions['limiter']
> = {
  max: 20,
  duration: 60_000,
  reservoir: 1000,
  reservoirRefreshAmount: 1000,
  reservoirRefreshInterval: 86_400_000,
};
