import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { PAYMENT_QUEUE_NAME } from '../constants/payment.constants';
import { PaymentService, PaymentQueueJobData, PaymentJobResult } from '../services/payment.service';

@Processor(PAYMENT_QUEUE_NAME)
export class PaymentProcessor extends WorkerHost {
  private readonly logger = new Logger(PaymentProcessor.name);

  constructor(private readonly paymentService: PaymentService) {
    super();
  }

  async process(job: Job<PaymentQueueJobData>): Promise<PaymentJobResult> {
    this.logger.debug(`Processing payment outbox job ${job.id}`);
    return this.paymentService.processOutbox(job.data.outboxId);
  }
}
