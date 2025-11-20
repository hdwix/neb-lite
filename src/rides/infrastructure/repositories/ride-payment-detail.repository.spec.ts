import { RidePaymentDetailRepository } from './ride-payment-detail.repository';
import { ERidePaymentDetailStatus } from '../../domain/constants/ride-payment-detail-status.enum';
import { PaymentOutboxStatus } from '../../domain/constants/payment.constants';

const createRunner = () => ({
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

    const result = await repository.save(repository.create({ rideId: '1', provider: 'x' }));

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

    const detail = await repository.save(repository.create({ rideId: '1', provider: 'x' }), runner);

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

  it('saves detail with ride and outbox updates transactionally', async () => {
    const runner = createRunner();
    runner.query
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([{ id: '1', ride_id: '1', provider: 'p', status: 'pending' }])
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
      .mockResolvedValueOnce([{ id: '1', ride_id: '1', provider: 'p', status: 'pending' }])
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
});
