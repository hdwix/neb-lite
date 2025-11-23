import {
  Catch,
  ExceptionFilter,
  ArgumentsHost,
  UnauthorizedException,
  ForbiddenException,
  HttpException,
  ExecutionContext,
  NotFoundException,
} from '@nestjs/common';
import { Response } from 'express';

@Catch(UnauthorizedException, ForbiddenException, NotFoundException) // Hanya menangkap error dari Guards
export class CustomExceptionFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    // Ambil ExecutionContext dari ArgumentsHost
    const executionContext = host.switchToHttp(); // Switch ke HTTP context
    const handler = (host as ExecutionContext).getHandler(); // Mendapatkan handler (controller method)

    // Jika handler undefined atau null, berarti exception terjadi di Guards
    if (!handler) {
      const statusCode = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      let message = 'Access Denied';

      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
      } else if (typeof exceptionResponse === 'object') {
        message =
          (exceptionResponse as any).message ||
          (exceptionResponse as any).error ||
          exception.message ||
          'Unauthorized';
      }

      // Return response dengan format seperti ResponseInterceptor
      return response.status(statusCode).json({
        meta: {
          code: statusCode,
          message: message,
        },
      });
    }

    // Jika exception bukan dari Guards, lempar ulang agar bisa ditangani Interceptor
    throw exception;
  }
}
