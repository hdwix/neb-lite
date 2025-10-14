import jwtConfig from './jwt.config';

describe('jwtConfig', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('parses configuration from environment variables', () => {
    process.env.JWT_SECRET = 'secret';
    process.env.JWT_ACCESS_TOKEN_TTL = '60';
    process.env.JWT_REFRESH_TOKEN_TTL = '120';

    const config = jwtConfig();

    expect(config).toEqual({
      secret: 'secret',
      accessTokenTtl: 60,
      refreshTokenTtl: 120,
    });
  });

  it('falls back to default values when env vars are missing', () => {
    delete process.env.JWT_SECRET;
    delete process.env.JWT_ACCESS_TOKEN_TTL;
    delete process.env.JWT_REFRESH_TOKEN_TTL;

    const config = jwtConfig();

    expect(config).toEqual({
      secret: undefined,
      accessTokenTtl: 3600,
      refreshTokenTtl: 8640000,
    });
  });
});
