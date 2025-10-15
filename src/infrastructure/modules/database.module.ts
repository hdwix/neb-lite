import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RiderProfile } from '../../iam/domain/entities/rider-profile.entity';
import { DriverProfile } from '../../iam/domain/entities/driver-profile.entity';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => ({
        type: 'postgres',
        host: configService.get<string>('POSTGRES_HOST'),
        port: configService.get<number>('POSTGRES_PORT'),
        username: configService.get<string>('POSTGRES_USER'),
        password: configService.get<string>('POSTGRES_PASSWORD'),
        database: configService.get<string>('POSTGRES_DB'),
        migrations: [__dirname + '/../migrations/*{.ts,.js}'],
        dateStrings: true,
        logging: false,
        autoLoadEntities: true,
        synchronize: configService.get<boolean>('DB_SYNCHRONIZE') || false,
        entities: [RiderProfile, DriverProfile],
      }),
    }),
  ],
  exports: [TypeOrmModule],
})
export class DatabaseModule {}
