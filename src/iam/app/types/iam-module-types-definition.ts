import { QueueLimiterOptions } from '../../../rides/domain/constants/route-estimation-limiter.constant';

export enum ESendOtpQueueJob {
  SendOtpJob = 'neblite-send-otp',
}

export const SEND_OTP_QUEUE_NAME = 'auth-service-send-otp';

export const SEND_OTP_QUEUE_LIMITER: QueueLimiterOptions = {
  max: 20,
  duration: 60_000,
  reservoir: 1000,
  reservoirRefreshAmount: 1000,
  reservoirRefreshInterval: 86_400_000,
};

export interface ISendOtpQueueData {
  msisdn: string;
  otp: string;
}
