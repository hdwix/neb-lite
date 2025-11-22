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
    repository = new PaymentOutboxRepository(
      dataSource,
      ridePaymentDetailRepository,
    );
  });

  it('creates outbox with defaults', () => {
    const outbox = repository.create({ orderId: 'ord' });

    expect(outbox.orderId).toBe('ord');
    expect(outbox.attempts).toBe(0);
    expect(outbox.requestPayload).toEqual({});
  });

  it('throws on save without id', async () => {
    await expect(repository.save(repository.create({}))).rejects.toThrow(
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

    const outbox = await repository.save(
      repository.create({ id: '1', status: row.status }),
    );

    expect(outbox.id).toBe('1');
    expect(outbox.requestPayload).toEqual({ a: 1 });
    expect(outbox.processedAt).toBeInstanceOf(Date);
  });

  it('throws when save query returns no rows', async () => {
    dataSource.query.mockResolvedValue([]);

    await expect(
      repository.save(
        repository.create({ id: '1', status: PaymentOutboxStatus.Pending }),
      ),
    ).rejects.toThrow('Failed to persist payment outbox');
  });

  it('saves with default attempts and empty payload when missing', async () => {
    const row = {
      id: 7,
      ride_id: 'ride-7',
      payment_detail_id: 'detail-7',
      order_id: 'ord-7',
      status: PaymentOutboxStatus.Pending,
      attempts: 0,
      job_id: null,
      request_payload: '{}',
      last_error: null,
      last_attempted_at: null,
      processed_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    dataSource.query.mockResolvedValue([row]);

    const outbox = await repository.save(
      repository.create({
        id: '7',
        status: PaymentOutboxStatus.Pending,
        requestPayload: undefined,
        attempts: undefined,
      }),
    );

    expect(dataSource.query).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining([expect.any(String), expect.any(String), expect.any(String), expect.any(String), expect.any(String), 0, null, '{}']),
    );
    expect(outbox.id).toBe('7');
    expect(outbox.requestPayload).toEqual({});
  });

  it('uses fallback defaults when attempts and payload are empty on save', async () => {
    const row = {
      id: '15',
      ride_id: 'ride-15',
      payment_detail_id: 'detail-15',
      order_id: 'ord-15',
      status: PaymentOutboxStatus.Pending,
      attempts: 0,
      job_id: null,
      request_payload: '{}',
      last_error: null,
      last_attempted_at: null,
      processed_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    dataSource.query.mockResolvedValue([row]);

    const outbox = new (PaymentOutboxRepository as any)(
      dataSource,
      ridePaymentDetailRepository,
    ).create({
      id: '15',
      rideId: 'ride-15',
      paymentDetailId: 'detail-15',
      orderId: 'ord-15',
      status: PaymentOutboxStatus.Pending,
    });

    outbox.attempts = undefined as any;
    outbox.requestPayload = null as any;

    const result = await repository.save(outbox as any);

    expect(dataSource.query).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining([
        '15',
        'ride-15',
        'detail-15',
        'ord-15',
        PaymentOutboxStatus.Pending,
        0,
        null,
        '{}',
      ]),
    );
    expect(result.requestPayload).toEqual({});
    expect(result.attempts).toBe(0);
  });

  it('saves detail and outbox in transaction', async () => {
    const runner = createQueryRunner();
    dataSource.createQueryRunner.mockReturnValue(runner);
    const savedDetail = { id: 'detail-1', rideId: 'ride-1' } as any;
    (ridePaymentDetailRepository.save as jest.Mock).mockResolvedValue(
      savedDetail,
    );
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

  it('stringifies empty payloads in saveDetailAndOutbox', async () => {
    const runner = createQueryRunner();
    dataSource.createQueryRunner.mockReturnValue(runner);
    const savedDetail = { id: 'detail-2', rideId: 'ride-2' } as any;
    (ridePaymentDetailRepository.save as jest.Mock).mockResolvedValue(
      savedDetail,
    );
    runner.query.mockResolvedValue([
      {
        id: 11,
        ride_id: savedDetail.rideId,
        payment_detail_id: savedDetail.id,
        order_id: 'order-2',
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

    await repository.saveDetailAndOutbox(savedDetail as any, {
      orderId: 'order-2',
      requestPayload: undefined as any,
      status: PaymentOutboxStatus.Pending,
    });

    expect(runner.query).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining([savedDetail.rideId, savedDetail.id, 'order-2', PaymentOutboxStatus.Pending, '{}']),
    );
  });

  it('rolls back transaction on saveDetailAndOutbox error', async () => {
    const runner = createQueryRunner();
    dataSource.createQueryRunner.mockReturnValue(runner);
    (ridePaymentDetailRepository.save as jest.Mock).mockRejectedValue(
      new Error('failed'),
    );

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

  it('throws when saveDetailAndOutbox does not create outbox row', async () => {
    const runner = createQueryRunner();
    dataSource.createQueryRunner.mockReturnValue(runner);
    (ridePaymentDetailRepository.save as jest.Mock).mockResolvedValue({
      id: 'detail-1',
      rideId: 'ride-1',
    });
    runner.query.mockResolvedValue([]);

    await expect(
      repository.saveDetailAndOutbox({} as any, {
        orderId: 'order-1',
        requestPayload: {},
        status: PaymentOutboxStatus.Pending,
      }),
    ).rejects.toThrow('Failed to create payment outbox entry');

    expect(runner.rollbackTransaction).toHaveBeenCalled();
    expect(runner.release).toHaveBeenCalled();
  });

  it('returns null when findById has no rows', async () => {
    dataSource.query.mockResolvedValue([]);

    const outbox = await repository.findById('1');
    expect(outbox).toBeNull();
  });

  it('maps numeric ids to strings when finding by id', async () => {
    dataSource.query.mockResolvedValue([
      {
        id: 9,
        ride_id: 8,
        payment_detail_id: 7,
        order_id: 'ord-9',
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

    const outbox = await repository.findById('9');

    expect(outbox?.id).toBe('9');
    expect(outbox?.rideId).toBe('8');
    expect(outbox?.paymentDetailId).toBe('7');
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

  it('returns null when findLatestPendingByRide has no rows', async () => {
    dataSource.query.mockResolvedValue([]);

    const outbox = await repository.findLatestPendingByRide('ride-1');

    expect(outbox).toBeNull();
  });

  it('keeps object payloads unchanged when mapping rows', async () => {
    const payload = { nested: true } as any;
    dataSource.query.mockResolvedValue([
      {
        id: '1',
        ride_id: '2',
        payment_detail_id: '3',
        order_id: 'ord',
        status: PaymentOutboxStatus.Pending,
        attempts: 0,
        job_id: null,
        request_payload: payload,
        last_error: null,
        last_attempted_at: null,
        processed_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ]);

    const outbox = await repository.findById('1');

    expect(outbox?.requestPayload).toBe(payload);
  });

  it('maps rows with missing ids without failing', () => {
    const entity = (repository as any).mapRowToEntity({
      ride_id: 'ride-no-id',
      payment_detail_id: 'detail-no-id',
      order_id: 'ord-missing',
      status: PaymentOutboxStatus.Pending,
      attempts: 0,
      request_payload: '{}',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    expect(entity.id).toBeUndefined();
    expect(entity.rideId).toBe('ride-no-id');
  });
});
