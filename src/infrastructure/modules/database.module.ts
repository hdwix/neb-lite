import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RiderProfile } from '../../iam/domain/entities/rider-profile.entity';
import { DriverProfile } from '../../iam/domain/entities/driver-profile.entity';
import axios from 'axios';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => {
        const isLocal = configService.get<string>('NODE_ENV') === 'local';

        let sslConfig;
        if (!isLocal) {
          // Fetch AWS RDS global CA bundle dynamically
          const caResponse = await axios.get(
            'https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem',
          );
          sslConfig = {
            ca: caResponse.data,
          };
        } else {
          sslConfig = false;
        }

        return {
          type: 'postgres',
          host: configService.get<string>('POSTGRES_HOST'),
          port: configService.get<number>('POSTGRES_PORT'),
          username: configService.get<string>('POSTGRES_USER'),
          password: configService.get<string>('POSTGRES_PASSWORD'),
          database: configService.get<string>('POSTGRES_DB'),
          entities: [RiderProfile, DriverProfile],
          migrations: [__dirname + '/../migrations/*{.ts,.js}'],
          autoLoadEntities: true,
          synchronize: configService.get('DB_SYNCHRONIZE') === 'true' || false,
          logging: false,
          ssl: sslConfig, // false for local, CA for non-local
        };
      },
    }),
  ],
  exports: [TypeOrmModule],
})
export class DatabaseModule {}
