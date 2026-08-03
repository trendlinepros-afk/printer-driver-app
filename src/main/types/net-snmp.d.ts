declare module 'net-snmp' {
  export interface VarBind {
    oid: string
    type: number
    value: Buffer | string | number | null
  }
  export interface SessionOptions {
    version?: number
    timeout?: number
    retries?: number
    port?: number
  }
  export interface Session {
    get(
      oids: string[],
      cb: (error: Error | null, varbinds: VarBind[]) => void
    ): void
    close(): void
    on(event: 'error', cb: (err: Error) => void): void
  }
  export const Version1: number
  export const Version2c: number
  export function createSession(
    target: string,
    community: string,
    options?: SessionOptions
  ): Session
  export function isVarbindError(vb: VarBind): boolean
}
