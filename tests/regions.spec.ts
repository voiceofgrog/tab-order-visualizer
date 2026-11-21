import { test, expect, type Page } from '@playwright/test';
import type {} from '../src/main';

const panelOf = (page: Page) => page.getByRole('region', { name: 'Tab order visualizer' });

async function open(page: Page, url: string) {
  await page.goto(url);
  await page.evaluate(() => window.TabOrderViz!.show());
  await expect(panelOf(page).getByRole('status').first()).toHaveText(/Tab stops/);
}

const visibleBadges = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelector('tab-order-viz')!.shadowRoot!.querySelectorAll<HTMLElement>('.badge')].filter(
      (b) => b.style.display !== 'none' && b.parentElement?.hidden === false,
    ).length,
  );

test.describe('region map', () => {
  test('groups a busy page by landmark, splitting huge landmarks into inferred groups', async ({ page }) => {
    await page.goto('/demo/busy.html');
    const regions = await page.evaluate(async () =>
      (await window.TabOrderViz!.scan()).regions.regions.map((g) => `${g.kind} ${g.role} "${g.name}" ${g.stops.length} stops, entered ${g.entries}`),
    );
    expect(regions).toEqual([
      'landmark complementary "Chat" 43 stops, entered 3',
      'landmark navigation "Main" 12 stops, entered 2',
      'inferred toolbar "Main › Mod actions" 8 stops, entered 1',
      'inferred ul "Main › Activity feed" 120 stops, entered 1',
      'landmark region "Stats" 6 stops, entered 1',
      'outside  "Outside any landmark" 30 stops, entered 1',
      'landmark contentinfo "Footer" 5 stops, entered 1',
    ]);
  });

  test('nested landmarks do not count as a fragmented order', async ({ page }) => {
    await page.goto('/demo/index.html');
    const entries = await page.evaluate(async () => (await window.TabOrderViz!.scan()).regions.regions.map((g) => g.entries));
    expect(Math.max(...entries)).toBe(1);
  });

  test('reports stops outside landmarks and an area Tab enters three times', async ({ page }) => {
    await page.goto('/demo/busy.html');
    const issues = await page.evaluate(async () =>
      (await window.TabOrderViz!.scan()).issues.map((i) => `${i.severity} ${i.source}:${i.rule} ${i.title}`),
    );
    expect(issues).toEqual(expect.arrayContaining([
      'advice tool:outside-landmarks 30 Tab stops outside any landmark',
      'advice tool:region-fragmented Tab enters "Chat" 3 separate times',
      'advice axe:region Content outside landmarks',
    ]));
  });
});

test.describe('duplicate landmarks', () => {
  test('two unnamed navigation landmarks are flagged; a uniquely named one is not', async ({ page }) => {
    await page.goto('/demo/good.html');
    const issues = await page.evaluate(async () => {
      document.body.insertAdjacentHTML('beforeend', '<nav><a href="#x">X</a></nav><nav><a href="#y">Y</a></nav>');
      return (await window.TabOrderViz!.scan()).issues.filter((i) => i.rule === 'landmark-duplicate').map((i) => `${i.title} [${i.labels.join(' | ')}]`);
    });
    expect(issues).toEqual(['2 navigation landmarks with the same name [X | Y]']);
  });
});

test.describe('region view', () => {
  test('is the default on a busy page, with one labelled box per region', async ({ page }) => {
    await open(page, '/demo/busy.html');
    await expect(panelOf(page).getByRole('radio', { name: 'Regions' })).toBeChecked();
    const labels = page.locator('tab-order-viz .rlabel');
    await expect(labels).toHaveCount(7);
    await expect(labels.first()).toHaveText('Chat · complementary · 43 stops · #1');
    await expect(labels.first()).toHaveAttribute(
      'title',
      'Chat: complementary landmark, 43 Tab stops, first reached at Tab press 1, entered 3 separate times. Click to show its stops.',
    );
    await expect(page.locator('tab-order-viz .rlabel.inferred')).toHaveCount(2);
    expect(await visibleBadges(page)).toBe(0);
  });

  test('is not the default on a small page', async ({ page }) => {
    await open(page, '/demo/index.html');
    await expect(panelOf(page).getByRole('radio', { name: 'Every stop' })).toBeChecked();
    await expect(page.locator('tab-order-viz .rlabel').first()).toBeHidden();
  });

  test('expanding a region from the panel shows only its stops', async ({ page }) => {
    await open(page, '/demo/busy.html');
    const panel = panelOf(page);
    await panel.getByRole('button', { name: 'Main › Mod actions' }).click();
    await expect(panel.getByRole('button', { name: 'Main › Mod actions' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('tab-order-viz .rlabel').first()).toBeHidden();
    expect(await visibleBadges(page)).toBe(8);
    await panel.getByRole('button', { name: 'Show all regions' }).click();
    await expect(page.locator('tab-order-viz .rlabel').first()).toBeVisible();
  });

  test('clicking a region box on the page expands it', async ({ page }) => {
    await open(page, '/demo/busy.html');
    await page.locator('tab-order-viz .rlabel', { hasText: 'Stats' }).click();
    await expect(panelOf(page).getByRole('button', { name: 'Stats' })).toHaveAttribute('aria-pressed', 'true');
    expect(await visibleBadges(page)).toBe(6);
  });
});

test.describe('region labels on crowded pages', () => {
  test('tiny stacked regions get compact labels that never overlap', async ({ page }) => {
    await page.goto('/demo/good.html');
    await page.evaluate(() => {
      const col = document.createElement('div');
      col.style.cssText = 'position:absolute; left:8px; top:120px; width:160px;';
      for (let i = 1; i <= 6; i++) {
        col.insertAdjacentHTML('beforeend', `<section aria-label="Widget ${i}" style="height:16px; overflow:hidden"><button style="font-size:10px">W${i}</button></section>`);
      }
      document.body.append(col);
      window.TabOrderViz!.show();
    });
    const panel = panelOf(page);
    await expect(panel.getByRole('status').first()).toHaveText(/Tab stops/);
    await panel.getByRole('radio', { name: 'Regions' }).check();
    const boxes = await page.evaluate(() =>
      [...document.querySelector('tab-order-viz')!.shadowRoot!.querySelectorAll<HTMLElement>('.rlabel')]
        .filter((l) => l.style.display !== 'none')
        .map((l) => {
          const r = l.getBoundingClientRect();
          return { x: r.x, y: r.y, w: r.width, h: r.height, text: l.textContent ?? '' };
        }),
    );
    const overlaps = boxes.flatMap((a, i) =>
      boxes.slice(i + 1)
        .filter((b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h)
        .map((b) => `${a.text} / ${b.text}`),
    );
    expect(overlaps).toEqual([]);
    expect(boxes.some((b) => /^Widget \d · 1$/.test(b.text))).toBe(true);
  });

  test('unnamed groups are named by the heading before them, or by what they are', async ({ page }) => {
    await page.goto('/demo/good.html');
    const names = await page.evaluate(async () => {
      const buttons = [1, 2, 3, 4].map((i) => `<button>Message ${i}</button>`).join('');
      const clips = [1, 2, 3, 4].map((i) => `<li><a href="#clip${i}">Clip ${i}</a></li>`).join('');
      document.body.insertAdjacentHTML('beforeend', `<div role="log">${buttons}</div><h2>Recent clips</h2><ul>${clips}</ul>`);
      return (await window.TabOrderViz!.scan()).regions.regions.filter((g) => g.kind === 'inferred').map((g) => g.name);
    });
    expect(names).toEqual(['message log (unnamed)', 'Recent clips']);
  });
});

test.describe('decluttering', () => {
  test('overlapping badges are merged into one range badge', async ({ page }) => {
    await open(page, '/demo/busy.html');
    await panelOf(page).getByRole('radio', { name: 'Every stop' }).check();
    await expect(page.locator('tab-order-viz .badge.grouped', { hasText: /^220–224 \(5\)$/ })).toBeVisible();
  });

  test('"Long jumps only" hides short hops but keeps every backward jump', async ({ page }) => {
    await open(page, '/demo/index.html');
    const count = (sel: string) => page.locator(`tab-order-viz ${sel}`).count();
    const before = { all: await count('path.real'), back: await count('path.jump') };
    await panelOf(page).getByRole('checkbox', { name: 'Long jumps only' }).check();
    await expect.poll(() => count('path.real')).toBeLessThan(before.all);
    expect(await count('path.jump')).toBe(before.back);
    expect(before.back).toBeGreaterThan(0);
  });
});

test.describe('two bookmarklets', () => {
  /** Opens the busy demo without its own script, then runs a bookmarklet's code, as a click would. */
  async function runBookmarklet(page: Page, file: string) {
    const { readFile } = await import('node:fs/promises');
    const url = await readFile(file, 'utf8');
    await page.route('**/dist/tov-full.js', (route) => route.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
    await page.goto('/demo/busy.html');
    await page.evaluate(decodeURIComponent(url.slice('javascript:'.length)));
    await expect(panelOf(page).getByRole('status').first()).toHaveText(/Tab stops/);
  }

  test('the standard bookmarklet includes the Region view', async ({ page }) => {
    await runBookmarklet(page, 'dist/bookmarklet.txt');
    await expect(panelOf(page).getByRole('radio', { name: 'Regions' })).toBeChecked();
    await expect(page.locator('tab-order-viz .rlabel')).toHaveCount(7);
  });

  test('the Firefox bookmarklet leaves it out and says why', async ({ page }) => {
    await runBookmarklet(page, 'dist/bookmarklet-firefox.txt');
    await expect(panelOf(page).getByRole('radio', { name: 'Regions' })).toHaveCount(0);
    await expect(page.locator('tab-order-viz .rlabel')).toHaveCount(0);
    await expect(panelOf(page).getByText(/^This is the Firefox version of the bookmarklet, which leaves out the Region view/)).toBeVisible();
    expect(await visibleBadges(page)).toBeGreaterThan(0);
  });
});
