declare module 'node:fs/promises' {
  export function mkdir(path: string, options?: unknown): Promise<unknown>;
  export function readdir(path: string, options?: unknown): Promise<any[]>;
  export function readFile(path: string, encoding?: string): Promise<string>;
  export function writeFile(path: string, data: string, encoding?: string): Promise<void>;
}

declare module 'node:fs' {
  export interface WriteStreamLike {
    write(chunk: string, encoding?: string, callback?: () => void): boolean;
    end(callback?: () => void): void;
    on(event: string, listener: (...args: any[]) => void): this;
    once(event: string, listener: (...args: any[]) => void): this;
    off(event: string, listener: (...args: any[]) => void): this;
  }

  export function createWriteStream(path: string, options?: unknown): WriteStreamLike;
}

declare module 'node:path' {
  const path: {
    join: (...parts: string[]) => string;
    resolve: (...parts: string[]) => string;
    dirname: (path: string) => string;
  };
  export default path;
}

declare module 'node:url' {
  export function fileURLToPath(url: string | URL): string;
}

declare const process: {
  argv: string[];
  stdout: {
    isTTY?: boolean;
    write: (chunk: string) => boolean;
  };
  exitCode?: number;
};
