/**
 * Minimal local declarations for the Bun APIs used in index.tsx.
 * Avoids pulling in the full @types/bun dependency just for three symbols.
 */
interface ImportMeta {
  /** Absolute path to the current file. */
  path: string;
  /** Absolute path to the current file's directory. */
  dir: string;
}

declare namespace Bun {
  function resolveSync(specifier: string, parent: string): string;
  function spawnSync(options: {
    cmd: string[];
    stdio?: Array<"inherit" | "pipe" | "ignore">;
    env?: Record<string, string | undefined>;
  }): { exitCode: number | null };
}
