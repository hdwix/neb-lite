jest.mock(
  '@nestjs/axios',
  () => ({
    HttpService: class {
      post = jest.fn();
    },
  }),
  { virtual: true },
);
