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
const { version } = JSON.parse(await readFile(`${root}package.json`, 'utf8'));
// The config's _comment entries document the file for people editing it; they are not
// needed at run time, so they are stripped from the bundles.
const stripConfigComments = {
  name: 'strip-config-comments',
  setup(b) {
    b.onLoad({ filter: /config[\\/][^\\/]+\.json$/ }, async (args) => {
      const strip = (v) => Array.isArray(v) ? v.map(strip) : v && typeof v === 'object'
        ? Object.fromEntries(Object.entries(v).filter(([k]) => k !== '_comment').map(([k, x]) => [k, strip(x)])) : v;
      return { contents: JSON.stringify(strip(JSON.parse(await readFile(args.path, 'utf8')))), loader: 'json' };
    });
  },
};
const common = { bundle: true, format: 'iife', target: 'es2022', minify: true, logLevel: 'warning', plugins: [compactCss, stripConfigComments], define: { __VERSION__: JSON.stringify(version) } };
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
const installPage = ({ demo, extension }) =>
  template
    .replace('{{HREF}}', () => escapeAttr(bookmarklet))
    .replace('{{CHARS}}', bookmarklet.length.toLocaleString('en-US'))
    .replace('{{VERSION}}', pkg.version)
    .replace('{{DEMO}}', demo)
    .replace('{{EXTENSION}}', extension);
// Local copy, served by scripts/serve.mjs from the repo root.
await writeFile(`${dist}/install.html`, installPage({ demo: '../demo/index.html', extension: '' }));

await copyFile(`${root}extension/manifest.json`, `${dist}/extension/manifest.json`);
await copyFile(`${root}extension/background.js`, `${dist}/extension/background.js`);
await copyFile(`${dist}/tov-full.js`, `${dist}/extension/tov-full.js`);
await copyFile(`${dist}/THIRD-PARTY-LICENSES.txt`, `${dist}/extension/THIRD-PARTY-LICENSES.txt`);

// Hostable site (GitHub Pages): every link relative, so it works under any sub-path.
// The extension zip is added by the CI workflow (scripts stay dependency-free).
const site = `${dist}/site`;
await mkdir(`${site}/demo`, { recursive: true });
await writeFile(`${site}/index.html`, installPage({
  demo: 'demo/index.html',
  extension: ' <a href="tab-order-visualizer-extension.zip">Download the extension (zip)</a>, unzip it, then load the folder as an unpacked extension.',
}));
for (const f of ['tov-full.js', 'bookmarklet.txt', 'THIRD-PARTY-LICENSES.txt']) await copyFile(`${dist}/${f}`, `${site}/${f}`);
for (const page of ['index.html', 'good.html', 'modal.html', 'csp.html']) {
  const html = await readFile(`${root}demo/${page}`, 'utf8');
  await writeFile(`${site}/demo/${page}`, html.replaceAll('src="/dist/tov-full.js"', 'src="../tov-full.js"'));
}
await writeFile(`${site}/.nojekyll`, ''); // serve files as-is, no Jekyll processing

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
console.log(`tov.js           ${kb(Buffer.byteLength(code))}`);
console.log(`bookmarklet.txt  ${kb(Buffer.byteLength(bookmarklet))} (${bookmarklet.length} characters; Firefox limit 65536)`);
console.log(`tov-full.js      ${kb((await readFile(`${dist}/tov-full.js`)).length)}`);
