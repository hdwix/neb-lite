import { ConfigService } from '@nestjs/config';
import { InternalServerErrorException, Logger } from '@nestjs/common';
import { DataEncryptionService } from './data-encryption.service';

const mockRandomBytes = jest.fn();
const mockCreateCipheriv = jest.fn();

jest.mock('crypto', () => ({
  randomBytes: (...args: unknown[]) => mockRandomBytes(...args),
  createCipheriv: (...args: unknown[]) => mockCreateCipheriv(...args),
}));

describe('DataEncryptionService', () => {
  const base64Key = Buffer.alloc(32, 1).toString('base64');
  const hexKey = Buffer.alloc(32, 2).toString('hex');
  const rawKey = '12345678901234567890123456789012';

  const createConfigService = (
    overrides: Partial<
      Record<'APP_PORT' | 'CLIENT_ENCRYPTION_KEY', string>
    > = {},
  ) => {
    const values = {
      APP_PORT: '3000',
      CLIENT_ENCRYPTION_KEY: base64Key,
      ...overrides,
    } as Record<string, string | undefined>;

    return {
      get: jest.fn((key: string) => values[key]),
    } as unknown as ConfigService;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockRandomBytes.mockReturnValue(Buffer.from('123456789012'));
    const mockCipher = {
      update: jest.fn(() => Buffer.from('cipher-update')),
      final: jest.fn(() => Buffer.from('-final')),
      getAuthTag: jest.fn(() => Buffer.from('auth-tag')),
    };
    mockCreateCipheriv.mockReturnValue(mockCipher);
  });

  it('throws when APP_PORT is not configured', () => {
    const configService = createConfigService({ APP_PORT: undefined });

    expect(() => new DataEncryptionService(configService)).toThrow(
      new InternalServerErrorException('Can not load ENV APP_PORT'),
    );
  });

  it('throws when CLIENT_ENCRYPTION_KEY is not configured', () => {
    const configService = createConfigService({
      CLIENT_ENCRYPTION_KEY: undefined,
    });

    expect(() => new DataEncryptionService(configService)).toThrow(
      new InternalServerErrorException(
        'CLIENT_ENCRYPTION_KEY is not configured',
      ),
    );
  });

  it('encrypts values using base64 encoded key', () => {
    const configService = createConfigService();
    const service = new DataEncryptionService(configService);
    const result = service.encrypt('secret');

    const expectedIv = Buffer.from('123456789012').toString('base64');
    const expectedEncrypted = Buffer.from('cipher-update-final').toString(
      'base64',
    );
    const expectedAuthTag = Buffer.from('auth-tag').toString('base64');

    expect(result).toBe(
      `${expectedIv}.${expectedEncrypted}.${expectedAuthTag}`,
    );
    expect(mockCreateCipheriv).toHaveBeenCalledTimes(1);
  });

  it('returns nullish values as-is without encrypting', () => {
    const service = new DataEncryptionService(createConfigService());

    expect(service.encrypt(undefined)).toBeNull();
    expect(service.encrypt(null)).toBeNull();
    expect(service.encrypt('')).toBe('');
    expect(mockCreateCipheriv).not.toHaveBeenCalled();
  });

  it('supports hex encoded encryption keys', () => {
    const configService = createConfigService({
      CLIENT_ENCRYPTION_KEY: hexKey,
    });

    expect(() => new DataEncryptionService(configService)).not.toThrow();
  });

  it('supports utf8 keys when decoding fails for base64 and hex', () => {
    const originalBufferFrom = Buffer.from.bind(Buffer);
    const bufferSpy = jest.spyOn(Buffer, 'from');
    bufferSpy.mockImplementation((value: any, encoding?: BufferEncoding) =>
      originalBufferFrom(value, encoding as BufferEncoding),
    );
    bufferSpy.mockImplementationOnce(() => {
      throw new Error('base64 decode failed');
    });
    bufferSpy.mockImplementationOnce(() => {
      throw new Error('hex decode failed');
    });

    const warnSpy = jest.spyOn(Logger.prototype, 'warn');
    const configService = createConfigService({
      CLIENT_ENCRYPTION_KEY: rawKey,
    });

    expect(() => new DataEncryptionService(configService)).not.toThrow();

    bufferSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('throws when encryption key has invalid length', () => {
    const configService = createConfigService({
      CLIENT_ENCRYPTION_KEY: 'short-key',
    });

    expect(() => new DataEncryptionService(configService)).toThrow(
      new InternalServerErrorException(
        'CLIENT_ENCRYPTION_KEY must be 32 bytes encoded in base64, hex, or utf8',
      ),
    );
  });

  it('raises InternalServerErrorException when encryption fails', () => {
    const service = new DataEncryptionService(createConfigService());
    const errorSpy = jest.spyOn(Logger.prototype, 'error');
    mockCreateCipheriv.mockImplementationOnce(() => {
      throw new Error('cipher failed');
    });

    expect(() => service.encrypt('boom')).toThrow(InternalServerErrorException);
    expect(errorSpy).toHaveBeenCalledWith(
      'Failed to encrypt value',
      expect.any(String),
    );

    errorSpy.mockRestore();
  });
});
