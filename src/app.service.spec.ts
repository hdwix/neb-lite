import { AppService } from './app.service';

describe('AppService', () => {
  it('returns hello world message', () => {
    const service = new AppService();
    expect(service.getHello()).toBe('Hello World!');
  });
});
