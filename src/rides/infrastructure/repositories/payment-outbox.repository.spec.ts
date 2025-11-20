import { PaymentOutboxRepository } from './payment-outbox.repository';
import { PaymentOutboxStatus } from '../../domain/constants/payment.constants';
import { RidePaymentDetailRepository } from './ride-payment-detail.repository';

const createQueryRunner = () => {
  const runner: any = {
    connect: jest.fn(),
    startTransaction: jest.fn(),
    commitTransaction: jest.fn(),
    rollbackTransaction: jest.fn(),
    release: jest.fn(),
    query: jest.fn(),
    manager: { query: jest.fn() },
    isTransactionActive: false,
    isReleased: false,
  };

  runner.rollbackTransaction.mockImplementation(() => {
    runner.isTransactionActive = false;
  });

  runner.startTransaction.mockImplementation(() => {
    runner.isTransactionActive = true;
  });

  runner.release.mockImplementation(() => {
    runner.isReleased = true;
  });

  return runner;
};

describe('PaymentOutboxRepository', () => {
  const dataSource = {
    query: jest.fn(),
    createQueryRunner: jest.fn(),
  } as any;

  const ridePaymentDetailRepository = {
    save: jest.fn(),
  } as any as RidePaymentDetailRepository;

  let repository: PaymentOutboxRepository;

  beforeEach(() => {
    jest.clearAllMocks();
    repository = new PaymentOutboxRepository(dataSource, ridePaymentDetailRepository);
  });

  it('creates outbox with defaults', () => {
    const outbox = repository.create({ orderId: 'ord' });

    expect(outbox.orderId).toBe('ord');
    expect(outbox.attempts).toBe(0);
    expect(outbox.requestPayload).toEqual({});
  });

  it('throws on save without id', async () => {
    await expect(repository.save(repository.create({})) ).rejects.toThrow(
      'Outbox id is required for updates',
    );
  });

  it('saves and maps row data', async () => {
    const row = {
      id: 1,
      ride_id: 2,
      payment_detail_id: 3,
      order_id: 'ord',
      status: PaymentOutboxStatus.Pending,
      attempts: 2,
      job_id: 'job',
      request_payload: '{"a":1}',
      last_error: 'err',
      last_attempted_at: '2023-01-01T00:00:00Z',
      processed_at: '2023-01-02T00:00:00Z',
      created_at: '2023-01-01T00:00:00Z',
      updated_at: '2023-01-02T00:00:00Z',
    };
    dataSource.query.mockResolvedValue([row]);

    const outbox = await repository.save(repository.create({ id: '1', status: row.status }));

    expect(outbox.id).toBe('1');
    expect(outbox.requestPayload).toEqual({ a: 1 });
    expect(outbox.processedAt).toBeInstanceOf(Date);
  });

  it('throws when save query returns no rows', async () => {
    dataSource.query.mockResolvedValue([]);

    await expect(
      repository.save(repository.create({ id: '1', status: PaymentOutboxStatus.Pending })),
    ).rejects.toThrow('Failed to persist payment outbox');
  });

  it('saves detail and outbox in transaction', async () => {
    const runner = createQueryRunner();
    dataSource.createQueryRunner.mockReturnValue(runner);
    const savedDetail = { id: 'detail-1', rideId: 'ride-1' } as any;
    (ridePaymentDetailRepository.save as jest.Mock).mockResolvedValue(savedDetail);
    runner.query.mockResolvedValue([
      {
        id: 10,
        ride_id: savedDetail.rideId,
        payment_detail_id: savedDetail.id,
        order_id: 'order-1',
        status: PaymentOutboxStatus.Pending,
        attempts: 0,
        job_id: null,
        request_payload: '{}',
        last_error: null,
        last_attempted_at: null,
        processed_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ]);

    const result = await repository.saveDetailAndOutbox(savedDetail as any, {
      orderId: 'order-1',
      requestPayload: { ok: true },
      status: PaymentOutboxStatus.Pending,
    });

    expect(result.detail).toBe(savedDetail);
    expect(result.outbox.orderId).toBe('order-1');
    expect(runner.commitTransaction).toHaveBeenCalled();
  });

  it('rolls back transaction on saveDetailAndOutbox error', async () => {
    const runner = createQueryRunner();
    dataSource.createQueryRunner.mockReturnValue(runner);
    (ridePaymentDetailRepository.save as jest.Mock).mockRejectedValue(new Error('failed'));

    await expect(
      repository.saveDetailAndOutbox({} as any, {
        orderId: 'order-1',
        requestPayload: {},
        status: PaymentOutboxStatus.Pending,
      }),
    ).rejects.toThrow('failed');

    expect(runner.rollbackTransaction).toHaveBeenCalled();
    expect(runner.release).toHaveBeenCalled();
  });

  it('returns null when findById has no rows', async () => {
    dataSource.query.mockResolvedValue([]);

    const outbox = await repository.findById('1');
    expect(outbox).toBeNull();
  });

  it('finds by id and maps json parsing failures to null', async () => {
    dataSource.query.mockResolvedValue([
      {
        id: '1',
        ride_id: '2',
        payment_detail_id: '3',
        order_id: 'ord',
        status: PaymentOutboxStatus.Completed,
        attempts: '1',
        job_id: null,
        request_payload: '{invalid',
        last_error: null,
        last_attempted_at: null,
        processed_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ]);

    const outbox = await repository.findById('1');

    expect(outbox?.requestPayload).toEqual({});
    expect(outbox?.status).toBe(PaymentOutboxStatus.Completed);
  });

  it('finds latest pending by ride', async () => {
    dataSource.query.mockResolvedValue([{ id: '5', ride_id: 'ride-1' }]);

    const outbox = await repository.findLatestPendingByRide('ride-1');

    expect(outbox?.id).toBe('5');
    expect(dataSource.query).toHaveBeenCalledWith(
      expect.stringContaining('WHERE ride_id'),
      ['ride-1', PaymentOutboxStatus.Pending],
    );
  });
});
