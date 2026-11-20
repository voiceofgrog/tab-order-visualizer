import { readFile } from 'node:fs/promises';
import { test, expect, type Page } from '@playwright/test';

async function axeViolations(page: Page): Promise<string[]> {
  await page.addScriptTag({ path: 'node_modules/axe-core/axe.min.js' });
  return page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run: (c: unknown, o: unknown) => Promise<{ violations: { id: string; nodes: unknown[] }[] }> } }).axe;
    const r = await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } });
    return r.violations.map((v) => `${v.id} (${v.nodes.length})`);
  });
}

test.describe('install page', () => {
  test('offers the current bookmarklet as a draggable link', async ({ page }) => {
    const expected = await readFile('dist/bookmarklet.txt', 'utf8');
    await page.goto('/dist/install.html');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('See how the Tab key moves through any page');
    await expect(page.getByRole('link', { name: 'Tab order' })).toHaveAttribute('href', expected);
    await expect(page.getByText(`Bookmarklet size: ${expected.length.toLocaleString('en-US')} characters`)).toBeVisible();
  });

  test('clicking the link runs the bookmarklet on the page', async ({ page }) => {
    await page.goto('/dist/install.html');
    await page.getByRole('link', { name: 'Tab order' }).click();
    await expect(page.getByRole('region', { name: 'Tab order visualizer' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Tab order visualizer' }).getByRole('status').first()).toHaveText(/Tab stops?\./);
  });

  test('copy fallback puts the bookmarklet on the clipboard', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/dist/install.html');
    await page.getByText("Can't drag it? Add it by hand").click();
    await page.getByRole('button', { name: 'Copy code' }).click();
    await expect(page.getByRole('status')).toHaveText(/^Copied\./);
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toBe(await readFile('dist/bookmarklet.txt', 'utf8'));
  });

  test('hostable site works from a sub-folder (as on GitHub Pages)', async ({ page }) => {
    // The local server serves the repo root, so dist/site/ is a sub-path, like /tab-order-visualizer/ on Pages.
    await page.goto('/dist/site/');
    await expect(page.getByRole('link', { name: 'Tab order' })).toHaveAttribute('href', /^javascript:/);
    await page.getByRole('link', { name: 'demo page with deliberate problems' }).click();
    await expect(page).toHaveURL(/\/dist\/site\/demo\/index\.html$/);
    await expect.poll(() => page.evaluate(() => typeof (window as unknown as { TabOrderViz?: unknown }).TabOrderViz)).toBe('object');
  });

  // Dogfooding: our own page must pass our own checks. (A rounded skip link once produced a
  // false "partly covered" advice here, because corner sample points fell outside the curve.)
  test('the tool finds no issues on the install page (bookmarklet build)', async ({ page }) => {
    await page.goto('/dist/install.html');
    await page.getByRole('link', { name: 'Tab order' }).click();
    const panel = page.getByRole('region', { name: 'Tab order visualizer' });
    await expect(panel.getByRole('status').first()).toHaveText(/Tab stops?\./);
    await expect(panel.getByText('No issues found by the automated checks')).toBeVisible();
  });

  test('the tool finds no issues on the install page (full build with axe-core)', async ({ page }) => {
    await page.goto('/dist/install.html');
    await page.addScriptTag({ path: 'dist/tov-full.js' });
    const r = await page.evaluate(async () => {
      const api = (window as unknown as { TabOrderViz: { scan(): Promise<{ axe: string; issues: { title: string }[] }> } }).TabOrderViz;
      const s = await api.scan();
      return { axe: s.axe, issues: s.issues.map((i) => i.title) };
    });
    expect(r).toEqual({ axe: 'ran', issues: [] });
  });

  for (const scheme of ['light', 'dark'] as const) {
    test(`has no WCAG A/AA violations in ${scheme} mode`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto('/dist/install.html');
      expect(await axeViolations(page)).toEqual([]);
    });
  }
});
