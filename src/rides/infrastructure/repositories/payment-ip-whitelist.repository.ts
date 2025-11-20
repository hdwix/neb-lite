/* istanbul ignore file */
import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

@Injectable()
export class PaymentIpWhitelistRepository {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async isIpAllowed(addresses: string[]): Promise<boolean> {
    const candidates = Array.from(new Set(addresses.filter(Boolean)));
    if (candidates.length === 0) {
      return false;
    }

    const rows = await this.dataSource.query(
      `
        SELECT 1
        FROM ip_payment_whitelist
        WHERE ip_address = ANY($1::text[])
        LIMIT 1;
      `,
      [candidates],
    );

    return rows.length > 0;
  }
}
