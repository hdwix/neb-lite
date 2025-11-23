import { NestFactory, Reflector } from '@nestjs/core';
import { NebengliteModule } from './nebenglite.module';
import {
  BadRequestException,
  ValidationError,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { ResponseInterceptor } from './app/interceptors/response.interceptor';
import { CustomExceptionFilter } from './app/filters/custom-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(NebengliteModule);
  const excludedPaths = ['/healthz', '/metrics'];
  const moduleRef = app.select(NebengliteModule);
  const reflector = moduleRef.get(Reflector);
  const configService = app.get(ConfigService);
  const serviceName = configService.get<string>('APP_NAME');
  const logger = app.get(Logger);
  app.useLogger(logger);
  app.use(helmet.hidePoweredBy());

  app.enableCors({
    origin: '*', // You can specify specific origins if needed
    methods: '*',
    allowedHeaders:
      'Content-Type, Authorization, msisdn, x-otp-simulation-token', // Specify any additional allowed headers if needed,
    credentials: true,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: false,
    }),
  );
  app.useGlobalInterceptors(new ResponseInterceptor(reflector, excludedPaths));
  app.useGlobalFilters(new CustomExceptionFilter());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidUnknownValues: true,
      transform: true,
      validateCustomDecorators: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
      exceptionFactory: (validationErrors: ValidationError[] = []) => {
        let message = '';
        const queue = [...validationErrors];
        const uniqueErrors = new Set();

        while (queue.length > 0) {
          const error = queue.shift();
          const errorId = `${error?.property}-${Object.keys(
            error?.constraints || {},
          ).join(',')}`;

          if (!uniqueErrors.has(errorId)) {
            uniqueErrors.add(errorId);
            if (error?.constraints) {
              const messages = Object.values(error.constraints).join(', ');
              message += messages + ', ';
            }
            // if error has children, queue the children for processing
            if (error?.children && error.children.length > 0) {
              queue.push(...error.children);
            }
          }
        }
        // Remove last comma and space
        message = message.slice(0, -2);
        return new BadRequestException(message || 'Validation failed');
      },
    }),
  );
  app.enableCors({
    origin: '*', // Specify your client domain
    credentials: true,
  });
  app.setGlobalPrefix('api', { exclude: excludedPaths });
  app.enableVersioning({
    type: VersioningType.URI,
  });

  const port = Number(configService.get<string>('APP_PORT') ?? '3000');
  await app.listen(port);
  logger.log(`${serviceName} is running on port ${port}`);
}
bootstrap();
