import { copyFileSync, cpSync, existsSync, rmSync } from 'node:fs';
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

/**
 * Publish the manifest next to the CSVs it describes, so a consumer can learn the latest close,
 * previous close and sector for every symbol in ONE request instead of fetching hundreds of CSVs.
 *
 * `build-manifest.ts` writes it to `site/src/data/` for Astro to import at build time; that copy is
 * bundled into the JS and is not reachable over HTTP. This copy is the published one.
 *
 * The copy has to happen HERE rather than in `build-manifest.ts`, and after the `cpSync` above: this
 * script deletes the whole `site/public/data` directory first, so anything written there earlier in
 * the build would be silently thrown away.
 */
const manifestSource = join('site', 'src', 'data', 'manifest.json');
if (!existsSync(manifestSource)) {
  throw new Error(`${manifestSource} not found. Run scripts/site/build-manifest.ts before this script.`);
}
const manifestTarget = join(target, 'manifest.json');
copyFileSync(manifestSource, manifestTarget);
console.log(`Published manifest to ${manifestTarget}`);
