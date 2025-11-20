import { RidePaymentRepository } from './ride-payment.repository';

describe('RidePaymentRepository', () => {
  const dataSource = {
    query: jest.fn(),
    createQueryRunner: jest.fn(),
  } as any;
  let repository: RidePaymentRepository;

  beforeEach(() => {
    jest.clearAllMocks();
    repository = new RidePaymentRepository(dataSource);
  });

  it('returns null when ride not found', async () => {
    dataSource.query.mockResolvedValue([]);
    await expect(repository.findById('1')).resolves.toBeNull();
  });

  it('maps ride row fields', async () => {
    dataSource.query.mockResolvedValue([
      {
        id: '1',
        riderId: '2',
        driverId: null,
        pickupLongitude: '1.23',
        pickupLatitude: '4.56',
        dropoffLongitude: '7.89',
        dropoffLatitude: '0.12',
        status: 'completed',
        discountPercent: '5',
        distanceEstimatedKm: '12',
        durationEstimatedSeconds: '100',
        distanceActualKm: '11',
        createdAt: new Date().toISOString(),
      },
    ]);

    const ride = await repository.findById('1');
    expect(ride?.id).toBe('1');
    expect(ride?.pickupLongitude).toBeCloseTo(1.23);
    expect(ride?.discountPercent).toBe(5);
  });

  it('updates payment state successfully', async () => {
    dataSource.query.mockResolvedValue([{}]);

    await repository.updatePaymentState('1', 'paid', 'url');

    expect(dataSource.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE rides'),
      ['1', 'paid', 'url'],
    );
  });

  it('throws when updatePaymentState finds no ride', async () => {
    dataSource.query.mockResolvedValue([]);

    await expect(
      repository.updatePaymentState('1', 'paid', null),
    ).rejects.toThrow('Ride not found while updating payment state');
  });

  it('returns null for unfinished rides when none found', async () => {
    dataSource.query.mockResolvedValue([]);

    const ride = await repository.findById('missing');
    expect(ride).toBeNull();
  });
});
