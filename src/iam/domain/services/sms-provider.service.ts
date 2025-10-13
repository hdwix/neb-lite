import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class SmsProviderService {
  private readonly logger = new Logger(SmsProviderService.name);

  constructor(private readonly configService: ConfigService) {}

  async sendOtp(phoneNumber: string, otpCode: string): Promise<void> {
    const smsServiceUrl = this.configService.get<string>('SMS_SERVICE_URL');

    if (!smsServiceUrl) {
      this.logger.warn('SMS service URL is not configured, skipping SMS send.');
      return;
    }

    const fetchFn = globalThis.fetch;

    if (!fetchFn) {
      this.logger.error('Fetch API is not available in the current runtime.');
      throw new ServiceUnavailableException('Failed to send OTP SMS');
    }

    try {
      const response = await fetchFn(smsServiceUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          phoneNumber,
          message: `Your Nebengjek verification code is ${otpCode}`,
        }),
      });

      if (!response.ok) {
        const errorBody = await response.text().catch(() => '');
        this.logger.error(
          `Failed to send OTP SMS. Status: ${response.status}. Body: ${errorBody}`,
        );
        throw new ServiceUnavailableException('Failed to send OTP SMS');
      }
    } catch (error) {
      const trace = error instanceof Error ? error.stack : undefined;
      this.logger.error('Unexpected error while sending OTP SMS', trace);
      throw new ServiceUnavailableException('Failed to send OTP SMS');
    }
  }
}
