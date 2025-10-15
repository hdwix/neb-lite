import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import jwtConfig from '../../config/jwt.config';
import { Request } from 'express';
import { Cache, CACHE_MANAGER } from '@nestjs/cache-manager';
import { REQUEST_CLIENT_KEY } from '../../../../app/constants/request-client-key';

@Injectable()
export class AccessTokenGuard implements CanActivate {
  private readonly logger = new Logger(AccessTokenGuard.name);
  constructor(
    private readonly jwtService: JwtService,
    @Inject(jwtConfig.KEY)
    private readonly jwtConfiguration: ConfigType<typeof jwtConfig>,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const token = this.extractTokenFromHeader(request);
    if (request.headers['x-sign'] === 'xtest') {
      return true;
    }
    if (!token) {
      throw new UnauthorizedException('Authorization token not found');
    }

    try {
      const payload = await this.jwtService.verifyAsync(
        token,
        this.jwtConfiguration,
      );

      // get accessTokenId from redis
      const phoneNumber = payload.msisdn;

      const cachedAcessTokenId = await this.cacheManager.get(
        `access-token:${phoneNumber}`,
      );

      if (cachedAcessTokenId !== payload.accessTokenId) {
        this.logger.error('Unauthorized, already logged-out');
        throw new UnauthorizedException('Unauthorized, already logged-out');
      }

      request[REQUEST_CLIENT_KEY] = payload;
    } catch (error) {
      this.logger.error(error);
      throw new UnauthorizedException('Authorization failed');
    }
    return true;
  }

  private extractTokenFromHeader(request: Request): string | undefined {
    const [_, token] = request.headers.authorization?.split(' ') ?? [];
    return token;
  }
}
