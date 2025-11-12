export const PAYMENT_QUEUE_NAME = 'ride-payment';

export enum PaymentQueueJob {
  InitiatePayment = 'initiate-payment',
}

export enum PaymentOutboxStatus {
  Pending = 'pending',
  Processing = 'processing',
  Completed = 'completed',
  Failed = 'failed',
}

export const PAYMENT_QUEUE_ATTEMPTS = 5;
export const PAYMENT_QUEUE_BACKOFF_MS = 2000;
export const PAYMENT_QUEUE_TIMEOUT_MS = 45_000;
