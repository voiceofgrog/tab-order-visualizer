// Builds three deliverables from one bundle:
//   dist/tov.js           the bundle (loaded by the demo page, tests and extension)
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

const common = { bundle: true, format: 'iife', target: 'es2020', minify: true, logLevel: 'warning' };
// Core build (no axe-core): small enough for a bookmarklet.
await build({ ...common, entryPoints: [`${root}src/main.ts`], outfile: `${dist}/tov.js`, legalComments: 'none' });
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

const code = (await readFile(`${dist}/tov.js`, 'utf8')).trim();
const bookmarklet =
  'javascript:' + encodeURIComponent(`(function(){if(!window.TabOrderViz){${code}}window.TabOrderViz.toggle();})();`);
await writeFile(`${dist}/bookmarklet.txt`, bookmarklet);

await writeFile(
  `${dist}/install.html`,
  `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Install the Tab-Order Visualizer bookmarklet</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:40rem;margin:2rem auto;padding:0 1rem}
a.bm{display:inline-block;padding:.5rem 1rem;border:2px solid #1a1a5e;border-radius:6px;color:#1a1a5e;font-weight:700;text-decoration:none}</style>
</head><body>
<h1>Install the bookmarklet</h1>
<p>Drag this link to your bookmarks bar:</p>
<p><a class="bm" href="${bookmarklet}">Tab order</a></p>
<p>Then open any page and click the bookmark. Click it again to close. Everything runs in your browser; nothing is sent anywhere.</p>
<p>Some sites block bookmarklets with a Content Security Policy. If nothing happens, use the browser extension build instead.</p>
</body></html>
`,
);

await copyFile(`${root}extension/manifest.json`, `${dist}/extension/manifest.json`);
await copyFile(`${root}extension/background.js`, `${dist}/extension/background.js`);
await copyFile(`${dist}/tov-full.js`, `${dist}/extension/tov-full.js`);
await copyFile(`${dist}/THIRD-PARTY-LICENSES.txt`, `${dist}/extension/THIRD-PARTY-LICENSES.txt`);

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
console.log(`tov.js           ${kb(Buffer.byteLength(code))}`);
console.log(`bookmarklet.txt  ${kb(Buffer.byteLength(bookmarklet))}`);
console.log(`tov-full.js      ${kb((await readFile(`${dist}/tov-full.js`)).length)}`);
