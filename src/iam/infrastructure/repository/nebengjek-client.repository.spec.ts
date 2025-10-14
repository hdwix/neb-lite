import { DataSource } from 'typeorm';
import { NebengjekClientRepository } from './nebengjek-client.repository';

describe('NebengjekClientRepository', () => {
  const dataSource = {
    createEntityManager: jest.fn(() => ({})),
    query: jest.fn(),
  } as unknown as DataSource;

  let repository: NebengjekClientRepository;

  beforeEach(() => {
    jest.resetAllMocks();
    repository = new NebengjekClientRepository(dataSource);
  });

  it('upserts user by phone', async () => {
    jest.spyOn(dataSource, 'query').mockResolvedValue(undefined);

    await repository.upsertUserByPhone('+6281112345678');

    expect(dataSource.query).toHaveBeenCalledWith(expect.stringContaining('INSERT'), [
      '+6281112345678',
    ]);
  });

  it('swallows errors when upsert fails', async () => {
    jest.spyOn(dataSource, 'query').mockRejectedValue(new Error('fail'));

    await expect(
      repository.upsertUserByPhone('+6281112345678'),
    ).resolves.toBeUndefined();
  });

  it('finds user by phone', async () => {
    jest.spyOn(dataSource, 'query').mockResolvedValue([{ id: 1 }]);

    const result = await repository.findUserByPhone('+6281112345678');

    expect(result).toEqual([{ id: 1 }]);
    expect(dataSource.query).toHaveBeenCalledWith(expect.stringContaining('SELECT'), [
      '+6281112345678',
    ]);
  });

  it('finds user by id', async () => {
    jest.spyOn(dataSource, 'query').mockResolvedValue([{ id: 1 }]);

    const result = await repository.findUserbyId(1);

    expect(result).toEqual([{ id: 1 }]);
    expect(dataSource.query).toHaveBeenCalledWith(expect.stringContaining('WHERE id=$1'), [
      1,
    ]);
  });
});
