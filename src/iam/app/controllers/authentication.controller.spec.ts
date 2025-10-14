import { Test, TestingModule } from '@nestjs/testing';
import { Response } from 'express';
import { AuthenticationController } from './authentication.controller';
import { AuthenticationService } from '../../domain/services/authentication.service';

describe('AuthenticationController', () => {
  let controller: AuthenticationController;
  let service: jest.Mocked<AuthenticationService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthenticationController],
      providers: [
        {
          provide: AuthenticationService,
          useValue: {
            getOtp: jest.fn(),
            verifyOtp: jest.fn(),
            getRefreshToken: jest.fn(),
            logout: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get(AuthenticationController);
    service = module.get(AuthenticationService);
  });

  it('delegates getOtp to service and returns otp code', async () => {
    service.getOtp.mockResolvedValue('123456');

    await expect(controller.getOtp({ phone: '+6281112345678' })).resolves.toBe(
      '123456',
    );
    expect(service.getOtp).toHaveBeenCalledWith({ phone: '+6281112345678' });
  });

  it('sets cookies when verifying otp', async () => {
    service.verifyOtp.mockResolvedValue({
      accessToken: 'access',
      refreshToken: 'refresh',
    });
    const response = {
      cookie: jest.fn().mockReturnThis(),
    } as unknown as Response;

    await controller.verifyOtp(
      { phone: '+6281112345678', otpCode: '111111' },
      response,
    );

    expect(service.verifyOtp).toHaveBeenCalledWith({
      phone: '+6281112345678',
      otpCode: '111111',
    });
    expect(response.cookie).toHaveBeenNthCalledWith(1, 'accesstoken', 'access', {
      secure: true,
      httpOnly: true,
      sameSite: true,
    });
    expect(response.cookie).toHaveBeenNthCalledWith(2, 'refreshtoken', 'refresh', {
      secure: true,
      httpOnly: true,
      sameSite: true,
    });
  });

  it('sets cookies when refreshing token', async () => {
    service.getRefreshToken.mockResolvedValue({
      accessToken: 'new-access',
      refreshToken: 'new-refresh',
    });
    const response = {
      cookie: jest.fn().mockReturnThis(),
    } as unknown as Response;

    await controller.getRefreshToken({ refreshToken: 'token' }, response);

    expect(service.getRefreshToken).toHaveBeenCalledWith({ refreshToken: 'token' });
    expect(response.cookie).toHaveBeenNthCalledWith(1, 'accesstoken', 'new-access', {
      secure: true,
      httpOnly: true,
      sameSite: true,
    });
    expect(response.cookie).toHaveBeenNthCalledWith(
      2,
      'refreshtoken',
      'new-refresh',
      {
        secure: true,
        httpOnly: true,
        sameSite: true,
      },
    );
  });

  it('delegates logout to service', async () => {
    service.logout.mockResolvedValue('logged out');

    await expect(controller.logout({ refreshToken: 'token' })).resolves.toBe(
      'logged out',
    );
    expect(service.logout).toHaveBeenCalledWith({ refreshToken: 'token' });
  });
});
