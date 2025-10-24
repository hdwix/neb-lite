import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  StreamableFile,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { of, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { Request } from 'express';

@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  public constructor(
    private readonly reflector: Reflector,
    private readonly excludePaths: string[] = [],
  ) {}

  public async intercept(
    context: ExecutionContext,
    next: CallHandler<any>,
  ): Promise<any> {
    const defaultMessageResponse = {
      200: 'OK',
      201: 'Created',
      202: 'Accepted',
      203: 'NonAuthoritativeInfo',
      204: 'NoContent',
      205: 'ResetContent',
      206: 'PartialContent',
    };

    const httpContext = context.switchToHttp();
    const request = httpContext.getRequest<Request>();
    const acceptHeader = request.headers['accept'];
    const acceptsEventStream = Array.isArray(acceptHeader)
      ? acceptHeader.some((value) => value?.includes('text/event-stream'))
      : acceptHeader?.includes('text/event-stream');

    if (acceptsEventStream) {
      return next.handle();
    }

    return next
      .handle()
      .pipe(
        catchError((error) => {
          const statusCode =
            error instanceof HttpException
              ? error.getStatus()
              : HttpStatus.INTERNAL_SERVER_ERROR;

          let message;
          if (statusCode === HttpStatus.PAYLOAD_TOO_LARGE) {
            message = 'File too large. Maximum size allowed is 5MB.';
          } else {
            message =
              error.response?.message ||
              error.message ||
              'Internal Server Error';
          }

          return throwError(
            () =>
              new HttpException(
                {
                  meta: {
                    code: statusCode,
                    message: message,
                  },
                },
                statusCode,
              ),
          );
        }),
      )
      .toPromise()
      .then(async (body) => {
        if (body instanceof StreamableFile) {
          return of(body);
        }
        if (body === undefined) {
          return of({
            message: null,
          });
        }

        const isExcludedPath = this.excludePaths.some((path) => {
          return path === request.url || request.url.startsWith(path);
        });

        if (isExcludedPath) {
          return of(body);
        }

        const status =
          this.reflector.get<number>('__httpCode__', context.getHandler()) ||
          (request.method === 'POST' ? 201 : 200);

        let messageResponse: string = '';
        if (defaultMessageResponse[status] !== undefined) {
          messageResponse = defaultMessageResponse[status];
        }

        if (body.messageResponse !== undefined) {
          messageResponse = body.messageResponse;
          delete body.messageResponse;
        }

        let metaBody;
        if (body.pagination !== undefined) {
          metaBody = {
            code: status,
            message: messageResponse,
            totalData: body.pagination.totalData,
            totalPage: body.pagination.totalPage,
            limit: body.pagination.limit,
            offset: body.pagination.offset,
          };
          delete body.pagination;
        } else if (body.totalData !== undefined) {
          metaBody = {
            code: status,
            message: messageResponse,
            totalData: body.totalData,
          };
          delete body.totalData;
        } else if (body.averageData !== undefined) {
          metaBody = {
            code: status,
            message: messageResponse,
            averageData: body.averageData,
          };
          delete body.totalData;
        } else if (body.paginationV2 !== undefined) {
          metaBody = {
            code: status,
            message: messageResponse,
            totalData: body.paginationV2.totalData,
            totalPage: body.paginationV2.totalPage,
            page: body.paginationV2.page,
          };
          delete body.totalData;
        } else {
          metaBody = {
            code: status,
            message: messageResponse,
          };
        }

        return of({
          meta: metaBody,
          data: body.data !== undefined ? body.data : body,
        });
      });
  }
}
