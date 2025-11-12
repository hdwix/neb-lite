declare module 'ulid' {
  export type MonotonicULIDFactory = (seedTime?: number) => string;
  export function monotonicFactory(seedTime?: number): MonotonicULIDFactory;
}
