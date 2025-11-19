import {
  BadRequestException,
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
import { DriverProfileRepository } from '../../../infrastructure/repository/driver-profile.repository';
import { RiderProfileRepository } from '../../../infrastructure/repository/rider-profile.repository';
import { EClientType } from '../../../../app/enums/client-type.enum';

@Injectable()
export class AccessTokenGuard implements CanActivate {
  private readonly logger = new Logger(AccessTokenGuard.name);
  constructor(
    private readonly jwtService: JwtService,
    @Inject(jwtConfig.KEY)
    private readonly jwtConfiguration: ConfigType<typeof jwtConfig>,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    private readonly riderProfileRepo: RiderProfileRepository,
    private readonly driverProfileRepo: DriverProfileRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const token = this.extractTokenFromHeader(request);
    if (!token) {
      throw new UnauthorizedException('Authorization token not found');
    }

    try {
      const payload = await this.jwtService.verifyAsync(
        token,
        this.jwtConfiguration,
      );

      const client = await this.getClientData(payload.sub, payload.role);
      const clientMsisdn = client[0]?.msisdn;

      // get accessTokenId from redis
      const clientId = payload.sub;
      const clientRole = payload.role;

      const cachedAcessTokenId = await this.cacheManager.get(
        `access-token:${clientRole}:${clientId}`,
      );

      if (cachedAcessTokenId !== payload.accessTokenId) {
        this.logger.error('Unauthorized, already logged-out');
        throw new UnauthorizedException('Unauthorized, already logged-out');
      }

      request[REQUEST_CLIENT_KEY] = {
        sub: payload.sub,
        role: payload.role,
        msisdn: clientMsisdn,
      };
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

  private async getClientData(clientId: string, clientType: EClientType) {
    const client =
      clientType === EClientType.RIDER
        ? await this.riderProfileRepo.findRiderbyId(clientId)
        : await this.driverProfileRepo.findDriverbyId(clientId);
    if (!client || client.length === 0) {
      throw new BadRequestException('client data not found');
    }
    return client;
  }
}
