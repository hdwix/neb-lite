import { ROUTE_ESTIMATION_QUEUE_LIMITER } from './route-estimation-limiter.constant';

describe('ROUTE_ESTIMATION_QUEUE_LIMITER', () => {
  it('exposes the expected limiter defaults', () => {
    expect(ROUTE_ESTIMATION_QUEUE_LIMITER).toEqual({
      max: 20,
      duration: 60_000,
      reservoir: 1000,
      reservoirRefreshAmount: 1000,
      reservoirRefreshInterval: 86_400_000,
    });
  });

  it('ensures no unexpected properties are present', () => {
    expect(Object.keys(ROUTE_ESTIMATION_QUEUE_LIMITER).sort()).toEqual([
      'duration',
      'max',
      'reservoir',
      'reservoirRefreshAmount',
      'reservoirRefreshInterval',
    ]);
  });
});
