import { Cache, CACHE_MANAGER } from '@nestjs/cache-manager';
import { Test, TestingModule } from '@nestjs/testing';
import { LocationService } from './location.service';

describe('LocationService', () => {
  let service: LocationService;
  let cacheManager: jest.Mocked<Cache>;
  let cacheStore: { keys: jest.Mock };

  beforeEach(async () => {
    cacheStore = {
      keys: jest.fn(),
    };
    cacheManager = {
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
      reset: jest.fn(),
      store: cacheStore,
    } as unknown as jest.Mocked<Cache>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LocationService,
        {
          provide: CACHE_MANAGER,
          useValue: cacheManager,
        },
      ],
    }).compile();

    service = module.get<LocationService>(LocationService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('upserts driver location and stores it in cache', async () => {
    cacheManager.get.mockResolvedValueOnce(undefined);
    cacheManager.set.mockResolvedValueOnce(undefined);

    const result = await service.upsertDriverLocation('driver-1', {
      lon: 106.8272,
      lat: -6.1754,
      accuracyMeters: 12,
    });

    expect(result.lon).toBe(106.8272);
    expect(result.lat).toBe(-6.1754);
    expect(result.accuracyMeters).toBe(12);
    expect(cacheManager.set).toHaveBeenCalledWith(
      'location:driver:driver-1',
      expect.objectContaining({
        lon: 106.8272,
        lat: -6.1754,
        accuracyMeters: 12,
      }),
    );
  });

  it('returns nearby drivers ordered by distance and limited', async () => {
    const keys = [
      'location:driver:driver-1',
      'location:driver:driver-2',
      'location:driver:driver-3',
    ];

    cacheStore.keys.mockResolvedValueOnce(keys);
    cacheManager.get.mockImplementation(async (key: string) => {
      switch (key) {
        case 'location:driver:driver-1':
          return {
            lon: 106.8272,
            lat: -6.1754,
            updatedAt: new Date().toISOString(),
          };
        case 'location:driver:driver-2':
          return {
            lon: 106.8,
            lat: -6.2,
            updatedAt: new Date().toISOString(),
          };
        case 'location:driver:driver-3':
          return {
            lon: 107.0,
            lat: -6.3,
            updatedAt: new Date().toISOString(),
          };
        default:
          return undefined;
      }
    });

    const results = await service.getNearbyDrivers(106.8272, -6.1754, 20000, 2);

    expect(results).toHaveLength(2);
    expect(results[0].driverId).toBe('driver-1');
    expect(results[0].distanceMeters).toBeCloseTo(0, 5);
    expect(results[1].driverId).toBe('driver-2');
    expect(results[1].distanceMeters).toBeLessThan(20000);
    expect(results[0].etaSeconds).toBeGreaterThanOrEqual(0);
  });
});
