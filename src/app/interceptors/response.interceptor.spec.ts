import { HttpException, HttpStatus, StreamableFile } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CallHandler, ExecutionContext } from '@nestjs/common/interfaces';
import { lastValueFrom, of, throwError } from 'rxjs';
import { ResponseInterceptor } from './response.interceptor';

describe('ResponseInterceptor', () => {
  const createExecutionContext = (request: any): ExecutionContext => {
    return {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => ({}),
    } as unknown as ExecutionContext;
  };

  const createCallHandler = (body: any): CallHandler<any> => ({
    handle: () => (typeof body === 'function' ? body() : of(body)),
  });

  const reflector = {
    get: jest.fn(),
  } as unknown as Reflector;

  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('wraps successful response with meta information', async () => {
    const interceptor = new ResponseInterceptor(reflector);
    const request = { method: 'GET', url: '/resource' };
    const result$ = await interceptor.intercept(
      createExecutionContext(request),
      createCallHandler({ data: { value: 1 } }),
    );
    const result = await lastValueFrom(result$);

    expect(result).toEqual({
      meta: { code: 200, message: 'OK' },
      data: { value: 1 },
    });
  });

  it('uses reflector status and pagination meta when provided', async () => {
    jest.spyOn(reflector, 'get').mockReturnValue(201);
    const interceptor = new ResponseInterceptor(reflector);
    const request = { method: 'POST', url: '/items' };
    const body = {
      messageResponse: 'Created resource',
      pagination: {
        totalData: 10,
        totalPage: 2,
        limit: 5,
        offset: 0,
      },
      data: ['a', 'b'],
    };

    const result$ = await interceptor.intercept(
      createExecutionContext(request),
      createCallHandler({ ...body }),
    );
    const result = await lastValueFrom(result$);

    expect(result).toEqual({
      meta: {
        code: 201,
        message: 'Created resource',
        totalData: 10,
        totalPage: 2,
        limit: 5,
        offset: 0,
      },
      data: ['a', 'b'],
    });
  });

  it('bypasses wrapping for excluded paths', async () => {
    const interceptor = new ResponseInterceptor(reflector, ['/health']);
    const request = { method: 'GET', url: '/health' };

    const result$ = await interceptor.intercept(
      createExecutionContext(request),
      createCallHandler({ raw: true }),
    );
    const result = await lastValueFrom(result$);

    expect(result).toEqual({ raw: true });
  });

  it('returns observable of StreamableFile directly', async () => {
    const interceptor = new ResponseInterceptor(reflector);
    const request = { method: 'GET', url: '/file' };
    const stream = new StreamableFile(Buffer.from('data'));

    const result$ = await interceptor.intercept(
      createExecutionContext(request),
      createCallHandler(() => of(stream)),
    );
    const result = await lastValueFrom(result$);

    expect(result).toBe(stream);
  });

  it('returns empty meta when handler resolves to undefined', async () => {
    const interceptor = new ResponseInterceptor(reflector);
    const request = { method: 'GET', url: '/resource' };

    const result$ = await interceptor.intercept(
      createExecutionContext(request),
      createCallHandler(undefined),
    );
    const result = await lastValueFrom(result$);

    expect(result).toEqual({ message: null });
  });

  it('includes totalData meta when provided', async () => {
    const interceptor = new ResponseInterceptor(reflector);
    const request = { method: 'GET', url: '/resource' };
    const result$ = await interceptor.intercept(
      createExecutionContext(request),
      createCallHandler({ totalData: 5, data: [1, 2] }),
    );
    const result = await lastValueFrom(result$);

    expect(result).toEqual({
      meta: { code: 200, message: 'OK', totalData: 5 },
      data: [1, 2],
    });
  });

  it('includes averageData meta when provided', async () => {
    const interceptor = new ResponseInterceptor(reflector);
    const request = { method: 'GET', url: '/resource' };
    const body = { averageData: 4.5, data: { score: 90 } };

    const result$ = await interceptor.intercept(
      createExecutionContext(request),
      createCallHandler({ ...body }),
    );
    const result = await lastValueFrom(result$);

    expect(result).toEqual({
      meta: { code: 200, message: 'OK', averageData: 4.5 },
      data: { score: 90 },
    });
  });

  it('includes paginationV2 meta when provided', async () => {
    const interceptor = new ResponseInterceptor(reflector);
    const request = { method: 'GET', url: '/resource' };
    const body = {
      paginationV2: { totalData: 5, totalPage: 1, page: 1 },
      data: ['item'],
    };

    const result$ = await interceptor.intercept(
      createExecutionContext(request),
      createCallHandler({ ...body }),
    );
    const result = await lastValueFrom(result$);

    expect(result).toEqual({
      meta: { code: 200, message: 'OK', totalData: 5, totalPage: 1, page: 1 },
      data: ['item'],
    });
  });

  it('wraps non-http errors in HttpException', async () => {
    const interceptor = new ResponseInterceptor(reflector);
    const request = { method: 'GET', url: '/resource' };

    await expect(
      interceptor.intercept(
        createExecutionContext(request),
        createCallHandler(() => throwError(() => new Error('boom'))),
      ),
    ).rejects.toBeInstanceOf(HttpException);
  });

  it('creates payload too large message when status is 413', async () => {
    const interceptor = new ResponseInterceptor(reflector);
    const request = { method: 'GET', url: '/resource' };

    await expect(
      interceptor.intercept(
        createExecutionContext(request),
        createCallHandler(() =>
          throwError(() => new HttpException('fail', HttpStatus.PAYLOAD_TOO_LARGE)),
        ),
      ),
    ).rejects.toMatchObject({
      response: {
        meta: {
          code: 413,
          message: 'File too large. Maximum size allowed is 5MB.',
        },
      },
      status: 413,
    });
  });
});
