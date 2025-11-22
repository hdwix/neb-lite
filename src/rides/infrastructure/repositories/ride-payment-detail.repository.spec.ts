import { RidePaymentDetailRepository } from './ride-payment-detail.repository';
import { ERidePaymentDetailStatus } from '../../domain/constants/ride-payment-detail-status.enum';
import { PaymentOutboxStatus } from '../../domain/constants/payment.constants';

const createRunner = () =>
  ({
    query: jest.fn(),
    connect: jest.fn(),
    release: jest.fn(),
  }) as any;

describe('RidePaymentDetailRepository', () => {
  const dataSource = {
    query: jest.fn(),
    createQueryRunner: jest.fn(),
  } as any;
  let repository: RidePaymentDetailRepository;

  beforeEach(() => {
    jest.clearAllMocks();
    repository = new RidePaymentDetailRepository(dataSource);
  });

  it('creates detail with defaults', () => {
    const detail = repository.create({ rideId: '1' });
    expect(detail.status).toBe(ERidePaymentDetailStatus.PENDING);
    expect(detail.rideId).toBe('1');
    expect(detail.id).toBeUndefined();
    expect(detail.provider).toBeUndefined();
    expect(detail.token).toBeNull();
    expect(detail.redirectUrl).toBeNull();
    expect(detail.orderId).toBeNull();
    expect(detail.providerTransactionId).toBeNull();
    expect(detail.requestPayload).toBeNull();
    expect(detail.responsePayload).toBeNull();
    expect(detail.notificationPayload).toBeNull();
    expect(detail.createdAt).toBeUndefined();
    expect(detail.updatedAt).toBeUndefined();
  });

  it('saves detail using datasource and maps response', async () => {
    const row = {
      id: '1',
      ride_id: '1',
      provider: 'x',
      status: ERidePaymentDetailStatus.SUCCESS,
      token: null,
      redirect_url: 'url',
      order_id: 'ord',
      provider_transaction_id: null,
      request_payload: '{"a":1}',
      response_payload: null,
      notification_payload: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    dataSource.query.mockResolvedValue([row]);

    const result = await repository.save(
      repository.create({ rideId: '1', provider: 'x' }),
    );

    expect(result.id).toBe('1');
    expect(result.requestPayload).toEqual({ a: 1 });
  });

  it('persists using query runner when provided', async () => {
    const runner = { query: jest.fn() } as any;
    runner.query.mockResolvedValue([
      {
        id: '2',
        ride_id: '1',
        provider: 'x',
        status: ERidePaymentDetailStatus.SUCCESS,
      },
    ]);

    const detail = await repository.save(
      repository.create({ rideId: '1', provider: 'x' }),
      runner,
    );

    expect(runner.query).toHaveBeenCalled();
    expect(detail.id).toBe('2');
  });

  it('finds by id/ride/order and returns null when missing', async () => {
    dataSource.query.mockResolvedValueOnce([]);
    expect(await repository.findById('1')).toBeNull();

    dataSource.query.mockResolvedValueOnce([]);
    expect(await repository.findByRideId('1')).toBeNull();

    dataSource.query.mockResolvedValueOnce([]);
    expect(await repository.findByOrderId('ord')).toBeNull();
  });

  it('findByOrderId maps row when present', async () => {
    dataSource.query.mockResolvedValue([
      {
        id: '3',
        ride_id: '1',
        provider: 'y',
        status: 'unknown',
        request_payload: '{bad json',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ]);

    const detail = await repository.findByOrderId('ord');
    expect(detail?.status).toBe(ERidePaymentDetailStatus.UNKNOWN);
    expect(detail?.requestPayload).toBeNull();
  });

  it('throws when persisting detail returns no rows', async () => {
    dataSource.query.mockResolvedValueOnce([]);

    await expect(
      repository.save(repository.create({ rideId: '1', provider: 'x' })),
    ).rejects.toThrow('Failed to persist ride payment detail');
  });

  it('serializes payloads when saving detail', async () => {
    const runner = { query: jest.fn() } as any;
    runner.query.mockResolvedValueOnce([
      {
        id: '20',
        ride_id: '1',
        provider: 'p',
        status: ERidePaymentDetailStatus.PENDING,
      },
    ]);

    const detail = repository.create({
      rideId: '1',
      provider: 'p',
      requestPayload: { foo: 'bar' },
      responsePayload: { baz: 2 },
      notificationPayload: { note: true },
    });

    await repository.save(detail, runner);

    const payloadArgs = runner.query.mock.calls[0][1];
    expect(payloadArgs[7]).toBe(JSON.stringify({ foo: 'bar' }));
    expect(payloadArgs[8]).toBe(JSON.stringify({ baz: 2 }));
    expect(payloadArgs[9]).toBe(JSON.stringify({ note: true }));
  });

  it('passes nullable and provided fields when saving detail', async () => {
    const runner = { query: jest.fn() } as any;
    const createdAt = new Date('2023-02-01T00:00:00Z');
    runner.query.mockResolvedValueOnce([
      {
        id: '25',
        ride_id: '5',
        provider: 'prov',
        status: ERidePaymentDetailStatus.PENDING,
        redirect_url: 'redirect',
        order_id: 'order-1',
        provider_transaction_id: 'txn-1',
        created_at: createdAt.toISOString(),
        updated_at: createdAt.toISOString(),
      },
    ]);

    const detail = repository.create({
      rideId: '5',
      provider: 'prov',
      token: 'tok',
      redirectUrl: 'redirect',
      orderId: 'order-1',
      providerTransactionId: 'txn-1',
      createdAt,
    });

    const saved = await repository.save(detail, runner);

    const args = runner.query.mock.calls[0][1];
    expect(args[4]).toBe('redirect');
    expect(args[5]).toBe('order-1');
    expect(args[6]).toBe('txn-1');
    expect(args[10]).toEqual(createdAt);
    expect(saved.redirectUrl).toBe('redirect');
    expect(saved.orderId).toBe('order-1');
    expect(saved.providerTransactionId).toBe('txn-1');
  });

  it('findById maps returned row with object payloads', async () => {
    const requestPayload = { nested: 'value' };
    dataSource.query.mockResolvedValueOnce([
      {
        id: '10',
        ride_id: '20',
        provider: 'a',
        status: ERidePaymentDetailStatus.PENDING,
        request_payload: requestPayload,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ]);

    const detail = await repository.findById('10');

    expect(detail?.id).toBe('10');
    expect(detail?.rideId).toBe('20');
    expect(detail?.requestPayload).toEqual(requestPayload);
  });

  it('uses provided query runner when finding by id', async () => {
    const runner = { query: jest.fn() } as any;
    runner.query.mockResolvedValueOnce([
      {
        id: '15',
        ride_id: '30',
        provider: 'q',
        status: ERidePaymentDetailStatus.PENDING,
        token: 't',
        redirect_url: 'redir',
        order_id: 'ord-15',
        provider_transaction_id: 'txn-15',
        response_payload: '{"ok":true}',
        notification_payload: '{"done":true}',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ]);

    const detail = await repository.findById('15', runner);

    expect(runner.query).toHaveBeenCalled();
    expect(detail?.orderId).toBe('ord-15');
    expect(detail?.providerTransactionId).toBe('txn-15');
    expect(detail?.responsePayload).toEqual({ ok: true });
    expect(detail?.notificationPayload).toEqual({ done: true });
  });

  it('returns null from findById when query runner yields no rows', async () => {
    const runner = { query: jest.fn().mockResolvedValue([]) } as any;

    const detail = await repository.findById('99', runner);

    expect(detail).toBeNull();
    expect(runner.query).toHaveBeenCalled();
  });

  it('findByRideId returns entity with normalized unknown status', async () => {
    dataSource.query.mockResolvedValueOnce([
      {
        id: '30',
        ride_id: '40',
        provider: 'p',
        status: 'not-a-status',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ]);

    const detail = await repository.findByRideId('40');

    expect(detail?.status).toBe(ERidePaymentDetailStatus.UNKNOWN);
  });

  it('saves detail with ride and outbox updates transactionally', async () => {
    const runner = createRunner();
    runner.query
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([
        { id: '1', ride_id: '1', provider: 'p', status: 'pending' },
      ])
      .mockResolvedValueOnce([{ id: 'ride-1' }])
      .mockResolvedValueOnce([{ id: 'outbox-1' }]);
    dataSource.createQueryRunner.mockReturnValue(runner);

    const detail = await repository.saveDetailWithRideUpdate({
      detail: repository.create({ rideId: '1', provider: 'p' }),
      rideUpdate: { rideId: '1', paymentStatus: 'paid', paymentUrl: 'url' },
      outboxUpdate: {
        rideId: '1',
        paymentDetailId: '2',
        orderId: 'ord',
        status: PaymentOutboxStatus.Completed,
        setProcessedAt: true,
      },
    });

    expect(detail.id).toBe('1');
    expect(runner.query).toHaveBeenCalledTimes(5);
    expect(runner.release).toHaveBeenCalled();
  });

  it('rolls back when ride update fails', async () => {
    const runner = createRunner();
    runner.query
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([
        { id: '1', ride_id: '1', provider: 'p', status: 'pending' },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'outbox-1' }]);
    dataSource.createQueryRunner.mockReturnValue(runner);

    await expect(
      repository.saveDetailWithRideUpdate({
        detail: repository.create({ rideId: '1', provider: 'p' }),
        rideUpdate: { rideId: '1', paymentStatus: 'paid' },
      }),
    ).rejects.toThrow('Ride not found while updating payment status');

    expect(runner.query).toHaveBeenCalledTimes(4);
  });

  it('uses null defaults when ride update payload omits values', async () => {
    const runner = createRunner();
    runner.query
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([
        { id: '1', ride_id: '1', provider: 'p', status: 'pending' },
      ])
      .mockResolvedValueOnce([{ id: 'ride-1' }])
      .mockResolvedValueOnce(undefined);
    dataSource.createQueryRunner.mockReturnValue(runner);

    await repository.saveDetailWithRideUpdate({
      detail: repository.create({ rideId: '1', provider: 'p' }),
      rideUpdate: { rideId: '1' },
    });

    const rideUpdateArgs = runner.query.mock.calls[2][1];
    expect(rideUpdateArgs).toEqual(['1', null, null]);
  });

  it('rolls back and throws when outbox update is missing', async () => {
    const runner = createRunner();
    runner.query
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([
        { id: '1', ride_id: '1', provider: 'p', status: 'pending' },
      ])
      .mockResolvedValueOnce([{ id: 'ride-1' }])
      .mockResolvedValueOnce([]);
    dataSource.createQueryRunner.mockReturnValue(runner);

    await expect(
      repository.saveDetailWithRideUpdate({
        detail: repository.create({ rideId: '1', provider: 'p' }),
        rideUpdate: { rideId: '1', paymentStatus: 'paid', paymentUrl: 'url' },
        outboxUpdate: {
          rideId: '1',
          paymentDetailId: '1',
          orderId: 'ord',
          status: PaymentOutboxStatus.Completed,
        },
      }),
    ).rejects.toThrow('Payment outbox entry not found while updating status');

    expect(runner.query).toHaveBeenCalledTimes(5);
    expect(runner.release).toHaveBeenCalled();
  });

  it('updates outbox with null identifiers when omitted', async () => {
    const runner = createRunner();
    runner.query
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([
        { id: '1', ride_id: '1', provider: 'p', status: 'pending' },
      ])
      .mockResolvedValueOnce([{ id: 'outbox-1' }])
      .mockResolvedValueOnce(undefined);
    dataSource.createQueryRunner.mockReturnValue(runner);

    await repository.saveDetailWithRideUpdate({
      detail: repository.create({ rideId: '1', provider: 'p' }),
      outboxUpdate: { orderId: 'ord', status: PaymentOutboxStatus.Completed },
    });

    const outboxArgs = runner.query.mock.calls[2][1];
    expect(outboxArgs).toEqual([
      'ord',
      null,
      null,
      PaymentOutboxStatus.Completed,
      null,
      false,
    ]);
  });
});
