// Builds the deliverables:
//   dist/tov.js           core bundle, no axe-core (source of the bookmarklet)
//   dist/tov-full.js      core + axe-core (demo pages, tests, extension)
//   dist/bookmarklet.txt  a self-contained javascript: URL (no network fetch)
//   dist/install.html     a page with a draggable bookmarklet link
//   dist/extension/       an unpacked Manifest V3 extension (load via chrome://extensions)
import { build } from 'esbuild';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = `${root}dist`;
await rm(dist, { recursive: true, force: true });
await mkdir(`${dist}/extension`, { recursive: true });

// The minifier leaves string contents alone, so collapse the indentation and line breaks
// inside the overlay's CSS template literal ourselves (saves ~1.5 KB of bookmarklet).
const compactCss = {
  name: 'compact-css',
  setup(b) {
    b.onLoad({ filter: /overlay\.ts$/ }, async (args) => {
      const src = await readFile(args.path, 'utf8');
      const contents = src.replace(/const STYLE = `([\s\S]*?)`;/, (_, css) =>
        'const STYLE = `' + css.replace(/\s*\n\s*/g, '').replace(/\s*([{}:;,])\s*/g, '$1') + '`;');
      return { contents, loader: 'ts' };
    });
  },
};
const common = { bundle: true, format: 'iife', target: 'es2022', minify: true, logLevel: 'warning', plugins: [compactCss] };
// Core build (no axe-core): small enough for a bookmarklet.
// The bookmarklet build swaps dom-accessibility-api for a small stand-in (src/accname-lite.ts).
await build({
  ...common,
  entryPoints: [`${root}src/main.ts`],
  outfile: `${dist}/tov.js`,
  legalComments: 'none',
  alias: { 'dom-accessibility-api': `${root}src/accname-lite.ts` },
});
// Full build (with axe-core): demo pages, tests and the extension.
await build({ ...common, entryPoints: [`${root}src/main-full.ts`], outfile: `${dist}/tov-full.js`, legalComments: 'eof' });

// axe-core is MPL-2.0: ship its license texts alongside any bundle that contains it.
const axeDir = `${root}node_modules/axe-core`;
const axeVersion = JSON.parse(await readFile(`${axeDir}/package.json`, 'utf8')).version;
const thirdParty = [
  `This bundle includes axe-core ${axeVersion}, unmodified, under the Mozilla Public License 2.0.`,
  'Source: https://github.com/dequelabs/axe-core',
  '',
  await readFile(`${axeDir}/LICENSE`, 'utf8'),
  '',
  await readFile(`${axeDir}/LICENSE-3RD-PARTY.txt`, 'utf8'),
].join('\n');
await writeFile(`${dist}/THIRD-PARTY-LICENSES.txt`, thirdParty);

// In a javascript: URL only a few characters must be escaped: % (the browser percent-decodes
// the URL before running it), # (would start a fragment) and line breaks. Encoding everything
// with encodeURIComponent inflated the URL by ~40%. Non-ASCII is already \u-escaped by esbuild.
const code = (await readFile(`${dist}/tov.js`, 'utf8')).trim();
const source = `(function(){if(!window.TabOrderViz){${code}}window.TabOrderViz.toggle();})();`;
const bookmarklet = 'javascript:' + source.replace(/[%#\r\n]/g, (c) => encodeURIComponent(c));
await writeFile(`${dist}/bookmarklet.txt`, bookmarklet);

// Firefox does not store bookmark URLs longer than 65,536 characters. Keep a safety margin.
const BOOKMARKLET_LIMIT = 60000;
if (bookmarklet.length > BOOKMARKLET_LIMIT) {
  console.warn(`WARNING: bookmarklet is ${bookmarklet.length} characters, over the ${BOOKMARKLET_LIMIT} budget. Firefox may refuse to save it.`);
  process.exitCode = 1;
}
const escapeAttr = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Install page: scripts/install.template.html with the bookmarklet, its size and the version filled in.
const pkg = JSON.parse(await readFile(`${root}package.json`, 'utf8'));
const template = await readFile(`${root}scripts/install.template.html`, 'utf8');
await writeFile(
  `${dist}/install.html`,
  template
    .replace('{{HREF}}', () => escapeAttr(bookmarklet))
    .replace('{{CHARS}}', bookmarklet.length.toLocaleString('en-US'))
    .replace('{{VERSION}}', pkg.version),
);

await copyFile(`${root}extension/manifest.json`, `${dist}/extension/manifest.json`);
await copyFile(`${root}extension/background.js`, `${dist}/extension/background.js`);
await copyFile(`${dist}/tov-full.js`, `${dist}/extension/tov-full.js`);
await copyFile(`${dist}/THIRD-PARTY-LICENSES.txt`, `${dist}/extension/THIRD-PARTY-LICENSES.txt`);

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
console.log(`tov.js           ${kb(Buffer.byteLength(code))}`);
console.log(`bookmarklet.txt  ${kb(Buffer.byteLength(bookmarklet))} (${bookmarklet.length} characters; Firefox limit 65536)`);
console.log(`tov-full.js      ${kb((await readFile(`${dist}/tov-full.js`)).length)}`);
