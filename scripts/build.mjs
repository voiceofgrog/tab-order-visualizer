// Builds the deliverables:
//   dist/tov.js                    core bundle, no axe-core (standard bookmarklet)
//   dist/tov-lite.js               core without the Region view (Firefox bookmarklet)
//   dist/tov-full.js               core + axe-core (demo pages, tests, extension)
//   dist/bookmarklet.txt           standard bookmarklet (Chrome, Edge, Safari)
//   dist/bookmarklet-firefox.txt   Firefox bookmarklet, under Firefox's bookmark size limit
//   dist/install.html              install page (picks the right bookmarklet for the browser)
//   dist/extension/                an unpacked Manifest V3 extension
//   dist/site/                     the hostable site (GitHub Pages)
import { build } from 'esbuild';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = `${root}dist`;
await rm(dist, { recursive: true, force: true });
await mkdir(`${dist}/extension`, { recursive: true });

// The minifier leaves string contents alone, so collapse the indentation and line breaks
// inside the overlay's CSS template literals ourselves.
const compactCss = {
  name: 'compact-css',
  setup(b) {
    b.onLoad({ filter: /overlay(-regions)?\.ts$/ }, async (args) => {
      const src = await readFile(args.path, 'utf8');
      const contents = src.replace(/const (STYLE|REGION_CSS) = `([\s\S]*?)`;/g, (_, name, css) =>
        `const ${name} = \`` + css.replace(/\s*\n\s*/g, '').replace(/\s*([{}:;,])\s*/g, '$1') + '`;');
      return { contents, loader: 'ts' };
    });
  },
};

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

const pkg = JSON.parse(await readFile(`${root}package.json`, 'utf8'));
const common = {
  bundle: true, format: 'iife', target: 'es2022', minify: true, logLevel: 'warning',
  plugins: [compactCss, stripConfigComments],
};
const define = (lite) => ({ __VERSION__: JSON.stringify(pkg.version), __LITE__: String(lite) });
// Bookmarklet builds swap dom-accessibility-api for a small stand-in (src/accname-lite.ts).
const bookmarkletBuild = { ...common, entryPoints: [`${root}src/main.ts`], legalComments: 'none', alias: { 'dom-accessibility-api': `${root}src/accname-lite.ts` } };

await build({ ...bookmarkletBuild, outfile: `${dist}/tov.js`, define: define(false) });
// Firefox: same, minus the Region view (__LITE__ removes that code entirely).
await build({ ...bookmarkletBuild, outfile: `${dist}/tov-lite.js`, define: define(true) });
// Full build (with axe-core): demo pages, tests and the extension.
await build({ ...common, entryPoints: [`${root}src/main-full.ts`], outfile: `${dist}/tov-full.js`, legalComments: 'eof', define: define(false) });

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
// the URL before running it), # (would start a fragment) and line breaks. Non-ASCII is
// already \u-escaped by esbuild.
const toBookmarklet = (code) =>
  'javascript:' + `(function(){if(!window.TabOrderViz){${code.trim()}}window.TabOrderViz.toggle();})();`.replace(/[%#\r\n]/g, (c) => encodeURIComponent(c));
const standard = toBookmarklet(await readFile(`${dist}/tov.js`, 'utf8'));
const firefox = toBookmarklet(await readFile(`${dist}/tov-lite.js`, 'utf8'));
await writeFile(`${dist}/bookmarklet.txt`, standard);
await writeFile(`${dist}/bookmarklet-firefox.txt`, firefox);

// Firefox truncates bookmark URLs longer than about 65,536 characters without warning: the
// Firefox version must stay under a safety budget. Chrome, Edge and Safari have no known limit
// near this size; the standard version only gets a warning so growth stays deliberate.
const FIREFOX_LIMIT = 60000;
const STANDARD_WARN = 90000;
if (firefox.length > FIREFOX_LIMIT) {
  console.error(`ERROR: Firefox bookmarklet is ${firefox.length} characters, over the ${FIREFOX_LIMIT} budget.`);
  process.exitCode = 1;
}
if (standard.length > STANDARD_WARN) console.warn(`WARNING: standard bookmarklet is ${standard.length} characters (over ${STANDARD_WARN}).`);

const escapeAttr = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const fmt = (n) => n.toLocaleString('en-US');

// Install page: scripts/install.template.html with both bookmarklets, sizes and version filled in.
const template = await readFile(`${root}scripts/install.template.html`, 'utf8');
const installPage = ({ demo, extension }) =>
  template
    .replaceAll('{{HREF}}', () => escapeAttr(standard))
    .replace('{{HREF_FIREFOX}}', () => escapeAttr(firefox))
    .replace('{{CHARS}}', fmt(standard.length))
    .replace('{{CHARS_FIREFOX}}', fmt(firefox.length))
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
for (const f of ['tov-full.js', 'bookmarklet.txt', 'bookmarklet-firefox.txt', 'THIRD-PARTY-LICENSES.txt']) await copyFile(`${dist}/${f}`, `${site}/${f}`);
for (const page of ['index.html', 'good.html', 'modal.html', 'csp.html', 'busy.html']) {
  const html = await readFile(`${root}demo/${page}`, 'utf8');
  await writeFile(`${site}/demo/${page}`, html.replaceAll('src="/dist/tov-full.js"', 'src="../tov-full.js"'));
}
await writeFile(`${site}/.nojekyll`, ''); // serve files as-is, no Jekyll processing

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
console.log(`bookmarklet.txt          ${fmt(standard.length)} characters (Chrome, Edge, Safari)`);
console.log(`bookmarklet-firefox.txt  ${fmt(firefox.length)} characters (Firefox; budget ${fmt(FIREFOX_LIMIT)}, limit 65,536)`);
console.log(`tov-full.js              ${kb((await readFile(`${dist}/tov-full.js`)).length)}`);
