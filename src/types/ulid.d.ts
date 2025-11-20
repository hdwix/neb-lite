declare module 'ulid' {
  export function monotonicFactory(): (time?: number) => string;
  export function ulid(time?: number): string;
  export default ulid;
}
