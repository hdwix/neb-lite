import { IsNotEmpty, IsString, Length, Min } from 'class-validator';

export class RefreshTokenDto {
  @IsNotEmpty()
  @IsString()
  @Length(100)
  refreshToken: string;
}
