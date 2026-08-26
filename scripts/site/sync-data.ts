import { cpSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Copies `data/` into `site/public/data` so the CSVs are served from the site's own origin.
 *
 * The charts fetch CSVs at runtime, so the files have to sit under the site's base path. Astro copies
 * everything in `public/` into `dist/`, which means one copy here covers both `astro dev` and the
 * deployed artifact, and the deploy workflow needs no separate assembly step.
 *
 * A symlink would avoid the 31MB copy, but symlinks in `public/` behave inconsistently across Astro
 * versions and platforms, and a wrong answer here is a site with no data at all.
 */
const target = join('site', 'public', 'data');
if (existsSync(target)) rmSync(target, { recursive: true });
cpSync('data', target, { recursive: true });
console.log(`Copied data/ to ${target}`);
