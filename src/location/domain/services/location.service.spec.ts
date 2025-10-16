import { Cache, CACHE_MANAGER } from '@nestjs/cache-manager';
import { Test, TestingModule } from '@nestjs/testing';
import { LocationService } from './location.service';

describe('LocationService', () => {
  let service: LocationService;
  let cacheManager: jest.Mocked<Cache>;

  beforeEach(async () => {
    cacheManager = {
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
      reset: jest.fn(),
      store: {},
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
      'location:drivers',
      expect.objectContaining({
        'driver-1': expect.objectContaining({
          lon: 106.8272,
          lat: -6.1754,
          accuracyMeters: 12,
        }),
      }),
    );
  });

  it('returns nearby drivers ordered by distance and limited', async () => {
    cacheManager.get.mockResolvedValueOnce({
      'driver-1': {
        lon: 106.8272,
        lat: -6.1754,
        updatedAt: new Date().toISOString(),
      },
      'driver-2': {
        lon: 106.8,
        lat: -6.2,
        updatedAt: new Date().toISOString(),
      },
      'driver-3': {
        lon: 107.0,
        lat: -6.3,
        updatedAt: new Date().toISOString(),
      },
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
