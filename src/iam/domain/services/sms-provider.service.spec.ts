import { ConfigService } from '@nestjs/config';
import { of, throwError } from 'rxjs';
import { SmsProviderService } from './sms-provider.service';
import { ServiceUnavailableException } from '@nestjs/common';

describe('SmsProviderService', () => {
  const configService = {
    get: jest.fn(),
  } as unknown as ConfigService;

  const httpService = {
    post: jest.fn(),
  } as any;

  let service: SmsProviderService;

  beforeEach(() => {
    jest.resetAllMocks();
    service = new SmsProviderService(configService, httpService);
  });

  it('skips sending sms when service url is not configured', async () => {
    jest.spyOn(configService, 'get').mockReturnValue(undefined);

    await service.sendOtp('+6281112345678', '123456');

    expect(httpService.post).not.toHaveBeenCalled();
  });

  it('sends sms when configuration is present', async () => {
    jest.spyOn(configService, 'get').mockReturnValue('https://sms');
    jest.spyOn(httpService, 'post').mockReturnValue(of({ data: 'ok' }));

    await service.sendOtp('+6281112345678', '123456');

    expect(httpService.post).toHaveBeenCalledWith('https://sms', {
      phoneNumber: '+6281112345678',
      message: 'Your Nebengjek verification code is 123456',
    });
  });

  it('throws ServiceUnavailableException when the provider fails', async () => {
    jest.spyOn(configService, 'get').mockReturnValue('https://sms');
    jest.spyOn(httpService, 'post').mockReturnValue(
      throwError(() => ({ response: { status: 500, data: { error: 'fail' } } })),
    );

    await expect(
      service.sendOtp('+6281112345678', '123456'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('throws ServiceUnavailableException when error has no response', async () => {
    jest.spyOn(configService, 'get').mockReturnValue('https://sms');
    jest.spyOn(httpService, 'post').mockReturnValue(
      throwError(() => ({ message: 'boom' })),
    );

    await expect(
      service.sendOtp('+6281112345678', '123456'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('handles Error instances without response objects', async () => {
    jest.spyOn(configService, 'get').mockReturnValue('https://sms');
    jest.spyOn(httpService, 'post').mockReturnValue(
      throwError(() => new Error('boom')),
    );

    await expect(
      service.sendOtp('+6281112345678', '123456'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
