import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * Absolute path to the repo-root `data/` directory.
 *
 * Anchoring this to `import.meta.url` was tried first and does not work: Astro relocates this
 * module's compiled chunk under `site/dist/.prerender/chunks/` during `astro build`, so
 * `import.meta.url` points there rather than at the source file, and a fixed number of `..` segments
 * resolves to the wrong place. `pnpm site:build` also runs `pnpm --dir site build`, which changes the
 * Node process's cwd to `site/` for that step, so a bare relative path like
 * `data/sip-mutual-funds/NI31.csv` resolves to the nonexistent `site/data/...` and `readRows` (or
 * `loadFundRefs`) silently returns nothing.
 *
 * Instead this walks upward from `process.cwd()` looking for the one file that reliably marks the
 * repo root: `data/reference/nepse-symbols.csv`. That file is never read here, only checked for
 * existence, so it stays a pure anchor rather than a second parse of reference data.
 */
function findDataDir(): string {
  let dir = process.cwd();
  for (let i = 0; i < 10; i++) {
    if (existsSync(path.join(dir, 'data', 'reference', 'nepse-symbols.csv'))) {
      return path.join(dir, 'data');
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('Could not locate the repo-root data/ directory from ' + process.cwd());
}

export const DATA_DIR = findDataDir();
