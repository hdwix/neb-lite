jest.mock('bcrypt', () => ({
  genSalt: jest.fn(),
  hash: jest.fn(),
  compare: jest.fn(),
}));

import { genSalt, hash as bcryptHash, compare as bcryptCompare } from 'bcrypt';
import { BcryptService } from './bcrypt.service';

describe('BcryptService', () => {
  let service: BcryptService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new BcryptService();
  });

  it('hashes data using bcrypt', async () => {
    (genSalt as jest.Mock).mockResolvedValue('salt');
    (bcryptHash as jest.Mock).mockResolvedValue('hashed');

    const result = await service.hash('data');

    expect(genSalt).toHaveBeenCalled();
    expect(bcryptHash).toHaveBeenCalledWith('data', 'salt');
    expect(result).toBe('hashed');
  });

  it('compares data using bcrypt', async () => {
    (bcryptCompare as jest.Mock).mockResolvedValue(true);

    await expect(service.compare('data', 'encrypted')).resolves.toBe(true);
    expect(bcryptCompare).toHaveBeenCalledWith('data', 'encrypted');
  });
});
