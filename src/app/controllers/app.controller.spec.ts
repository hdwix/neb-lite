import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';

describe('AppController', () => {
  let controller: AppController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
    }).compile();

    controller = module.get(AppController);
  });

  it('returns hello message', async () => {
    await expect(controller.getHello()).resolves.toBe('Hello from controller');
  });

  it('returns public hello message', async () => {
    await expect(controller.getPublicHello()).resolves.toBe(
      'Hello Public from controller',
    );
  });

  it('returns customer hello message', async () => {
    await expect(controller.getCustomerHello()).resolves.toBe(
      'Hello Customer from controller',
    );
  });

  it('returns driver hello message', async () => {
    await expect(controller.getDriverHello()).resolves.toBe(
      'Hello Driver from controller',
    );
  });
});
