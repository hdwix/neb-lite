import { HttpService } from '@nestjs/axios';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { lastValueFrom } from 'rxjs';
import {
  ISendOtpQueueData,
  SEND_OTP_QUEUE_NAME,
} from '../../app/types/iam-module-types-definition';
import { Job } from 'bullmq';

@Processor(SEND_OTP_QUEUE_NAME, { concurrency: 5 })
export class SmsProcessor extends WorkerHost {
  private readonly logger = new Logger(SmsProcessor.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
  ) {
    super();
  }

  async process(job: Job<ISendOtpQueueData>): Promise<any> {
    this.logger.log(`processing queue send-otp for ${job.data.msisdn}`);
    await this.sendOtp(job.data.msisdn, job.data.otp);
  }

  async sendOtp(phoneNumber: string, otpCode: string): Promise<void> {
    const smsServiceUrl = this.configService.get<string>('SMS_SERVICE_URL');

    if (!smsServiceUrl) {
      this.logger.error(
        'SMS service URL is not configured, skipping SMS send.',
      );
      return;
    }

    try {
      await lastValueFrom(
        this.httpService.post(smsServiceUrl, {
          phoneNumber,
          message: `Your Nebengjek verification code is ${otpCode}`,
        }),
      );
    } catch (error) {
      const response = (
        error as { response?: { status?: number; data?: unknown } }
      )?.response;
      const status = response?.status;
      const body = response?.data;

      if (status) {
        this.logger.error(
          `Failed to send OTP SMS. Status: ${status}. Body: ${JSON.stringify(body)}`,
        );
      } else {
        const trace = error instanceof Error ? error.stack : undefined;
        this.logger.error('Unexpected error while sending OTP SMS', trace);
      }

      throw new ServiceUnavailableException('Failed to send OTP SMS');
    }
  }
}
