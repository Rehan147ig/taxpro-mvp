declare module 'bcryptjs' {
  export function hash(s: string, salt: string | number): Promise<string>;
  export function compare(s: string, hash: string): Promise<boolean>;
  export function genSalt(rounds?: number): Promise<string>;
}

declare module 'jsonwebtoken' {
  export function sign(payload: object, secret: string, options?: object): string;
  export function verify(token: string, secret: string): object;
}

declare module 'archiver' {
  import { Readable } from 'stream';
  export class ZipArchive {
    constructor(options?: { zlib?: { level?: number } });
    on(event: string, listener: (...args: any[]) => void): this;
    append(data: string | Buffer | Readable, options?: { name: string }): this;
    finalize(): Promise<void>;
  }
  export default function create(format: string, options?: object): ZipArchive;
}
