declare module "phoenix" {
  export class Socket {
    constructor(endpoint: string, options?: Readonly<Record<string, unknown>>);
  }
}
