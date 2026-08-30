export {};

declare module "react" {
  interface HTMLAttributes<T> {
    [attribute: `phx-${string}`]:
      | string
      | number
      | bigint
      | boolean
      | null
      | undefined;
  }
}
