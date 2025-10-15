import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Res,
} from '@nestjs/common';
import { GetOtpDto } from '../../../app/dto/get-otp.dto';
import { RefreshTokenDto } from '../../../app/dto/refresh-token.dto';
import { VerifyOtpDto } from '../../../app/dto/verify-otp.dto';
import { EAuthType } from '../../../app/enums/auth-type.enum';
import { Auth } from '../../../iam/app/decorators/auth.decorator';
import { AuthenticationService } from '../../../iam/domain/services/authentication.service';
import { Response } from 'express';

@Controller({ path: 'gateway', version: '1' })
export class GatewayController {
  constructor(private readonly authService: AuthenticationService) {}

  @HttpCode(HttpStatus.OK)
  @Auth(EAuthType.None)
  @Post('auth/request-otp')
  async getOtp(@Body() getOtpDto: GetOtpDto) {
    return await this.authService.getOtp(getOtpDto);
  }

  @HttpCode(HttpStatus.OK)
  @Auth(EAuthType.None)
  @Post('auth/verify-otp')
  async verifyOtp(
    @Body() verifyOtpDto: VerifyOtpDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const token = await this.authService.verifyOtp(verifyOtpDto);
    response.cookie('accesstoken', token.accessToken, {
      secure: true,
      httpOnly: true,
      sameSite: true,
    });
    response.cookie('refreshtoken', token.refreshToken, {
      secure: true,
      httpOnly: true,
      sameSite: true,
    });
  }

  @Post('auth/refresh-token')
  @Auth(EAuthType.None)
  @HttpCode(HttpStatus.OK)
  async getRefreshToken(
    @Body() refreshTokenDto: RefreshTokenDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const refreshToken =
      await this.authService.getRefreshToken(refreshTokenDto);
    response.cookie('accesstoken', refreshToken.accessToken, {
      secure: true,
      httpOnly: true,
      sameSite: true,
    });
    response.cookie('refreshtoken', refreshToken.refreshToken, {
      secure: true,
      httpOnly: true,
      sameSite: true,
    });
  }

  @Post('auth/logout')
  @Auth(EAuthType.None)
  @HttpCode(HttpStatus.OK)
  async logout(@Body() refreshTokenDto: RefreshTokenDto) {
    return await this.authService.logout(refreshTokenDto);
  }
}
