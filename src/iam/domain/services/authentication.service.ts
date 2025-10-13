import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { NebengjekClientRepository } from '../../infrastructure/repository/nebengjek-client.repository';
import { GetOtpDto } from '../../../app/dto/get-otp.dto';
import { Cache, CACHE_MANAGER } from '@nestjs/cache-manager';
import { HashingService } from './hashing.service';
import { ConfigService, ConfigType } from '@nestjs/config';
import { VerifyOtpDto } from '../../../app/dto/verify-otp.dto';
import jwtConfig from '../../app/config/jwt.config';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { RefreshTokenDto } from '../../../app/dto/refresh-token.dto';

@Injectable()
export class AuthenticationService {
  private readonly logger = new Logger(AuthenticationService.name);
  constructor(
    private readonly nebengjekClientRepo: NebengjekClientRepository,
    private readonly hashingService: HashingService,
    private readonly configService: ConfigService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    private readonly jwtService: JwtService,
    @Inject(jwtConfig.KEY)
    private readonly jwtConfiguration: ConfigType<typeof jwtConfig>,
  ) {}
  async getOtp(getOtpDto: GetOtpDto) {
    const cachedKey = this.getOtpCachedKey(getOtpDto.phone);
    await this.nebengjekClientRepo.upsertUserByPhone(getOtpDto.phone);
    const otpCode = this.generateOtp();
    const hashedCode = await this.hashingService.hash(otpCode);

    const otpTtl = this.configService.get<number>('OTP_TTL_SEC');
    await this.cacheManager.set(cachedKey, hashedCode, otpTtl);
    return otpCode;

    // await smsProvider.send
  }

  async verifyOtp(verifyOtpDto: VerifyOtpDto) {
    const client = await this.nebengjekClientRepo.findUserByPhone(
      verifyOtpDto.phone,
    );
    console.log(client);
    if (!client) {
      this.logger.error(`Client does not exist, phone not found`);
      throw new UnauthorizedException(
        `Unauthorized resource access for phone : ${verifyOtpDto.phone}`,
      );
    }

    const cachedKey = this.getOtpCachedKey(verifyOtpDto.phone);
    const cachedHashedOtpCode = await this.cacheManager.get<string>(cachedKey);
    if (!cachedHashedOtpCode) {
      this.logger.error(`Otp code not found`);
      throw new UnauthorizedException(
        `Otp code not found : ${verifyOtpDto.otpCode}`,
      );
    }
    console.log(cachedHashedOtpCode);
    const isEqual = await this.hashingService.compare(
      verifyOtpDto.otpCode,
      cachedHashedOtpCode,
    );
    if (!isEqual) {
      throw new UnauthorizedException('OTP code does not match');
    }
    await this.cacheManager.del(cachedKey);
    return await this.generateTokens(client[0]);
  }

  async getRefreshToken(refreshTokenDto: RefreshTokenDto) {
    try {
      const { client, refreshTokenId } =
        await this.getClientAndTokenIdInfo(refreshTokenDto);
      const isValidRefreshToken = await this.validateRefreshToken(
        client,
        refreshTokenId,
      );

      if (isValidRefreshToken) {
        return this.generateTokens(client[0]);
      } else {
        this.logger.error('error validating refresh token');
        throw new BadRequestException('error validating refresh token');
      }
    } catch (error) {
      this.logger.error(error);
      throw new UnauthorizedException('Unauthoried refreshtoken');
    }
  }

  private generateOtp() {
    return String(Math.floor(100000 + Math.random() * 900000)); // 6 digits
  }

  private getOtpCachedKey(phone) {
    return `otp:${phone}`;
  }

  private getRefreshTokenCacheKey(phone) {
    console.log('key refresh', phone);
    return `refresh-token:${phone}`;
  }

  async generateTokens(client: any) {
    const refreshTokenId = randomUUID();
    // const key;
    const [accessToken, refreshToken] = await Promise.all([
      this.signToken(client.id, this.jwtConfiguration.accessTokenTtl, {
        role: client.role,
      }),
      this.signToken(client.id, this.jwtConfiguration.refreshTokenTtl, {
        refreshTokenId,
        role: client.role,
      }),
    ]);
    const getCachedRefreshTokenKey = this.getRefreshTokenCacheKey(
      client.phone_number,
    );
    await this.cacheManager.set(
      getCachedRefreshTokenKey,
      refreshTokenId,
      this.jwtConfiguration.refreshTokenTtl,
    );
    return {
      accessToken,
      refreshToken,
    };
  }

  private async signToken<T>(clientId: number, expiresIn: number, payload?: T) {
    console.log(' expiresIn  : ');
    console.log(expiresIn);
    return await this.jwtService.signAsync(
      {
        sub: clientId,
        ...payload,
      },
      {
        secret: this.jwtConfiguration.secret,
        expiresIn,
      },
    );
  }

  async logout(refreshTokenDto: RefreshTokenDto) {
    const { client, refreshTokenId } =
      await this.getClientAndTokenIdInfo(refreshTokenDto);
    const isValidRefreshToken = await this.validateRefreshToken(
      client,
      refreshTokenId,
    );
    if (isValidRefreshToken) {
      return 'successfully logout';
    } else {
      this.logger.error('error validating refresh token');
      throw new BadRequestException('error validating refresh token');
    }
  }

  private async validateRefreshToken(client: any, refreshTokenId: string) {
    const cachedRefreshTokenKey = this.getRefreshTokenCacheKey(
      client[0].phone_number,
    );
    const refreshTokenIdFromCache = await this.cacheManager.get(
      cachedRefreshTokenKey,
    );

    console.log('client in refresh toekn :');
    console.log(client);

    console.log('refreshTokenId : ');
    console.log(refreshTokenId);
    console.log('');
    console.log('refreshTokenIdFromCache : ');
    console.log(refreshTokenIdFromCache);
    console.log('');

    if (refreshTokenIdFromCache === refreshTokenId) {
      await this.cacheManager.del(cachedRefreshTokenKey);
      return true;
    } else {
      throw new Error('Refresh token is invalid');
      return false;
    }
  }

  async getClientAndTokenIdInfo(refreshTokenDto: RefreshTokenDto) {
    const { sub, refreshTokenId } = await this.jwtService.verifyAsync(
      refreshTokenDto.refreshToken,
      {
        secret: this.jwtConfiguration.secret,
      },
    );
    const client = await this.nebengjekClientRepo.findUserbyId(sub);
    return { client, refreshTokenId };
  }
}
