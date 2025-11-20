import { PaymentIpWhitelistRepository } from './payment-ip-whitelist.repository';

describe('PaymentIpWhitelistRepository', () => {
  const dataSource = {
    query: jest.fn(),
  } as any;
  let repository: PaymentIpWhitelistRepository;

  beforeEach(() => {
    jest.clearAllMocks();
    repository = new PaymentIpWhitelistRepository(dataSource);
  });

  it('returns false when no valid addresses are provided', async () => {
    const result = await repository.isIpAllowed(['', null as any, undefined as any]);

    expect(result).toBe(false);
    expect(dataSource.query).not.toHaveBeenCalled();
  });

  it('deduplicates addresses and returns true when query matches', async () => {
    dataSource.query.mockResolvedValue([{ id: 1 }]);

    const result = await repository.isIpAllowed([
      '127.0.0.1',
      '127.0.0.1',
      '::ffff:127.0.0.1',
    ]);

    expect(result).toBe(true);
    expect(dataSource.query).toHaveBeenCalledWith(
      expect.stringContaining('ip_payment_whitelist'),
      [['127.0.0.1', '::ffff:127.0.0.1']],
    );
  });

  it('returns false when query returns no rows', async () => {
    dataSource.query.mockResolvedValue([]);

    const result = await repository.isIpAllowed(['10.0.0.1']);

    expect(result).toBe(false);
  });
});
