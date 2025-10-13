import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        //level: 'debug',
        formatters: {
          level: (label) => {
            return { level: label.toUpperCase() };
          },
        },
        customLevels: {
          emerg: 80,
          alert: 70,
          crit: 60,
          error: 50,
          warn: 40,
          notice: 30,
          info: 20,
          debug: 10,
        },
        useOnlyCustomLevels: true,
        //timestamp: pino.stdTimeFunctions.isoTime,
        transport: {
          target: 'pino-pretty',
          options: {
            singleLine: true,
            colorize: true,
            levelFirst: true,
            translateTime: 'SYS:standard',
            ignore: 'hostname,pid',
          },
        },
      },
    }),
  ],
  exports: [LoggerModule],
})
export class LoggingModule {}
