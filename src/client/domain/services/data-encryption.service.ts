import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, randomBytes } from 'crypto';

const AES_256_GCM_ALGORITHM = 'aes-256-gcm';
const AES_256_GCM_KEY_LENGTH = 32;
const AES_256_GCM_IV_LENGTH = 12;

@Injectable()
export class DataEncryptionService {
  private readonly logger = new Logger(DataEncryptionService.name);
  private readonly encryptionKey: Buffer;

  constructor(private readonly configService: ConfigService) {
    const appPort = this.configService.get<string>('APP_PORT');
    const rawKey = this.configService.get<string>('CLIENT_ENCRYPTION_KEY');
    if (!appPort) {
      throw new InternalServerErrorException('Can not load ENV APP_PORT');
    }

    if (!rawKey) {
      throw new InternalServerErrorException(
        'CLIENT_ENCRYPTION_KEY is not configured',
      );
    }

    this.encryptionKey = this.normalizeKey(rawKey);
  }

  encrypt(value?: string | null): string | null {
    if (value === undefined || value === null || value.length === 0) {
      return value ?? null;
    }

    try {
      const iv = randomBytes(AES_256_GCM_IV_LENGTH);
      const cipher = createCipheriv(
        AES_256_GCM_ALGORITHM,
        this.encryptionKey,
        iv,
      );

      const encrypted = Buffer.concat([
        cipher.update(value, 'utf8'),
        cipher.final(),
      ]);
      const authTag = cipher.getAuthTag();

      return [iv, encrypted, authTag]
        .map((buffer) => buffer.toString('base64'))
        .join('.');
    } catch (error) {
      const err = error as Error;
      this.logger.error('Failed to encrypt value', err.stack);
      throw new InternalServerErrorException('Failed to encrypt value');
    }
  }

  private normalizeKey(key: string): Buffer {
    const base64Buffer = this.tryDecode(key, 'base64');
    if (base64Buffer?.length === AES_256_GCM_KEY_LENGTH) {
      return base64Buffer;
    }

    const hexBuffer = this.tryDecode(key, 'hex');
    if (hexBuffer?.length === AES_256_GCM_KEY_LENGTH) {
      return hexBuffer;
    }

    if (key.length === AES_256_GCM_KEY_LENGTH) {
      return Buffer.from(key, 'utf8');
    }

    throw new InternalServerErrorException(
      'CLIENT_ENCRYPTION_KEY must be 32 bytes encoded in base64, hex, or utf8',
    );
  }

  private tryDecode(value: string, encoding: BufferEncoding): Buffer | null {
    try {
      return Buffer.from(value, encoding);
    } catch (error) {
      this.logger.warn(`Failed to decode encryption key using ${encoding}`);
      return null;
    }
  }
}
