import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { GetOtpDto } from '../../../app/dto/get-otp.dto';
import { Cache, CACHE_MANAGER } from '@nestjs/cache-manager';
import { HashingService } from './hashing.service';
import { ConfigService, ConfigType } from '@nestjs/config';
import { VerifyOtpDto } from '../../../app/dto/verify-otp.dto';
import jwtConfig from '../../app/config/jwt.config';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { RefreshTokenDto } from '../../../app/dto/refresh-token.dto';
import { SmsProviderService } from './sms-provider.service';
import { RiderProfileRepository } from '../../infrastructure/repository/rider-profile.repository';
import { DriverProfileRepository } from '../../infrastructure/repository/driver-profile.repository';
import { EClientType } from '../../../app/enums/client-type.enum';

@Injectable()
export class AuthenticationService {
  private readonly logger = new Logger(AuthenticationService.name);
  constructor(
    private readonly hashingService: HashingService,
    private readonly configService: ConfigService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    private readonly jwtService: JwtService,
    @Inject(jwtConfig.KEY)
    private readonly jwtConfiguration: ConfigType<typeof jwtConfig>,
    private readonly riderProfileRepo: RiderProfileRepository,
    private readonly driverProfileRepo: DriverProfileRepository,
  ) {}
  async getOtp(getOtpDto: GetOtpDto) {
    const cachedKey = this.getOtpCachedKey(getOtpDto.msisdn);
    const client = await this.getClientData(
      getOtpDto.msisdn,
      getOtpDto.clientType,
    );
    if (!client || client.length === 0) {
      this.logger.error('Unauthorized: client not found');
      throw new BadRequestException('Client not found');
    }
    const otpCode = this.generateOtp();
    const hashedCode = await this.hashingService.hash(otpCode);

    const otpTtl = this.configService.get<number>('OTP_TTL_SEC');
    await this.cacheManager.set(cachedKey, hashedCode, otpTtl);

    // await smsProvider.send

    return otpCode;
  }

  async verifyOtp(verifyOtpDto: VerifyOtpDto) {
    const client = await this.getClientData(
      verifyOtpDto.msisdn,
      verifyOtpDto.clientType,
    );
    if (!client || client.length === 0) {
      this.logger.error('Unauthorized: client not found');
      throw new BadRequestException('Client not found');
    }

    const cachedKey = this.getOtpCachedKey(verifyOtpDto.msisdn);
    const cachedHashedOtpCode = await this.cacheManager.get<string>(cachedKey);
    if (!cachedHashedOtpCode) {
      this.logger.error(`Otp code not found`);
      throw new UnauthorizedException(
        `Otp code not found : ${verifyOtpDto.otpCode}`,
      );
    }
    const isEqual = await this.hashingService.compare(
      verifyOtpDto.otpCode,
      cachedHashedOtpCode,
    );
    if (!isEqual) {
      this.logger.error(`invalid otp-code`);
      throw new UnauthorizedException('invalid otp-code');
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
    return `refresh-token:${phone}`;
  }

  getAccessTokenKey(phone: any) {
    return `access-token:${phone}`;
  }

  async generateTokens(client: any) {
    const accessTokenId = randomUUID();
    const refreshTokenId = randomUUID();

    const [accessToken, refreshToken] = await Promise.all([
      this.signToken(client.id, this.jwtConfiguration.accessTokenTtl, {
        accessTokenId,
        role: client.role,
        msisdn: client.msisdn,
      }),
      this.signToken(client.id, this.jwtConfiguration.refreshTokenTtl, {
        refreshTokenId,
        role: client.role,
        msisdn: client.msisdn,
      }),
    ]);
    const getCachedRefreshTokenKey = this.getRefreshTokenCacheKey(
      client.msisdn,
    );
    const getAccessTokenKey = this.getAccessTokenKey(client.msisdn);
    await Promise.all([
      this.cacheManager.set(
        getCachedRefreshTokenKey,
        refreshTokenId,
        this.jwtConfiguration.refreshTokenTtl,
      ),
      this.cacheManager.set(
        getAccessTokenKey,
        accessTokenId,
        this.jwtConfiguration.accessTokenTtl * 1000,
      ),
    ]);

    return {
      accessToken,
      refreshToken,
    };
  }

  private async signToken<T>(clientId: number, expiresIn: number, payload?: T) {
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
      const getAccessTokenKey = this.getAccessTokenKey(client[0].msisdn);
      await this.cacheManager.del(getAccessTokenKey);
      return 'successfully logout';
    } else {
      this.logger.error('error validating refresh token');
      throw new BadRequestException('error validating refresh token');
    }
  }

  private async validateRefreshToken(client: any, refreshTokenId: string) {
    const cachedRefreshTokenKey = this.getRefreshTokenCacheKey(
      client[0].msisdn,
    );
    const refreshTokenIdFromCache = await this.cacheManager.get(
      cachedRefreshTokenKey,
    );

    if (refreshTokenIdFromCache === refreshTokenId) {
      await this.cacheManager.del(cachedRefreshTokenKey);
      return true;
    } else {
      this.logger.error('Refresh token is invalid');
      return false;
    }
  }

  async getClientAndTokenIdInfo(refreshTokenDto: RefreshTokenDto) {
    const { sub, refreshTokenId, role, msisdn } =
      await this.jwtService.verifyAsync(refreshTokenDto.refreshToken, {
        secret: this.jwtConfiguration.secret,
      });
    const client = await this.getClientData(msisdn, role);

    return { client, refreshTokenId };
  }

  private async getClientData(msisdn: string, clientType: EClientType) {
    console;
    if (clientType === EClientType.RIDER) {
      return await this.riderProfileRepo.findRiderByPhone(msisdn);
    } else {
      return await this.driverProfileRepo.findDriverByPhone(msisdn);
    }
  }
}
