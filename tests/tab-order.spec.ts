import { readFile } from 'node:fs/promises';
import { test, expect, type Page } from '@playwright/test';
import type {} from '../src/main'; // brings in the window.TabOrderViz type

/**
 * Asks the tool for its order, and remembers the element list in the page so later
 * Tab presses can be matched by identity, not by text. Returns "N label" strings.
 */
async function toolOrder(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const { stops } = window.TabOrderViz!.compute();
    (window as unknown as { __stops: Element[] }).__stops = stops.map((s) => s.element);
    return stops.map((s) => `${s.index} ${s.label}`);
  });
}

/** Presses Tab once and reports where focus really went, in the same "N label" format. */
async function tabAndDescribe(page: Page, labels: string[]): Promise<string> {
  await page.keyboard.press('Tab');
  return page.evaluate((labels) => {
    let a: Element | null = document.activeElement;
    while (a?.shadowRoot?.activeElement) a = a.shadowRoot.activeElement;
    if (!a || a === document.body) return 'BODY (left the page)';
    const i = (window as unknown as { __stops: Element[] }).__stops.indexOf(a);
    if (i >= 0) return labels[i];
    const text = (a.getAttribute('aria-label') ?? a.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 40);
    return `NOT IN TOOL'S LIST: <${a.localName}> "${text}"`;
  }, labels);
}

test.describe('demo page', () => {
  test('reported order matches real Tab presses', async ({ page }) => {
    await page.goto('/demo/index.html?trap=off');
    const expected = await toolOrder(page);
    expect(expected.length).toBeGreaterThan(10);

    const actual: string[] = [];
    for (let i = 0; i < expected.length; i++) actual.push(await tabAndDescribe(page, expected));
    expect(actual).toEqual(expected);

    // One more Tab must not find a stop the tool missed.
    const after = await tabAndDescribe(page, expected);
    expect(after === 'BODY (left the page)' || after === expected[0], `after last stop: ${after}`).toBe(true);
  });

  test('positive tabindex jumps ahead of the header links', async ({ page }) => {
    await page.goto('/demo/index.html');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('searchbox', { name: 'Search the site' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Contact' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'News' })).toBeFocused();
  });

  test('a radio group is one Tab stop', async ({ page }) => {
    await page.goto('/demo/index.html');
    await page.getByRole('radio', { name: 'Medium' }).focus();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('radio', { name: 'Red' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('textbox', { name: 'Email' })).toBeFocused();
  });

  test('positive tabindex inside Shadow DOM only reorders within the component', async ({ page }) => {
    await page.goto('/demo/index.html');
    await page.getByRole('button', { name: 'Subscribe' }).focus();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Widget tabindex 1' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Widget first in source' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Slotted help link' })).toBeFocused();
  });

  test('the demo keyboard trap really traps (test-data check)', async ({ page }) => {
    await page.goto('/demo/index.html');
    const editor = page.getByRole('textbox', { name: 'Notes editor' });
    await editor.focus();
    await page.keyboard.press('Tab');
    await expect(editor).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(editor).toBeFocused();
  });

  test('tool explains elements that Tab skips', async ({ page }) => {
    await page.goto('/demo/index.html');
    const skipped = await page.evaluate(() =>
      window.TabOrderViz!.compute().skipped.map((s) => `${s.label}: ${s.reason}`),
    );
    const find = (label: string) => skipped.find((s) => s.startsWith(`${label}:`));
    expect(find('Not rendered button')).toContain('display: none');
    expect(find('Disabled button')).toContain('disabled');
    expect(find('Script-only button')).toContain('tabindex="-1"');
    expect(find('Inert button')).toContain('inert');
    expect(find('Option inside closed details')).toContain('closed <details>');
    expect(find('Small')).toContain('radio group');
  });

  test('tool flags focusable-but-invisible stops', async ({ page }) => {
    await page.goto('/demo/index.html');
    const hidden = await page.evaluate(() =>
      window.TabOrderViz!.compute().stops.filter((s) => s.hidden).map((s) => `${s.label}: ${s.hidden}`),
    );
    expect(hidden).toEqual([
      'Offscreen promo link: it is positioned off-screen',
      'Invisible button: it has opacity: 0',
    ]);
  });
});

test.describe('overlay', () => {
  test('does not change layout or tab order', async ({ page }) => {
    await page.goto('/demo/index.html');
    const snapshot = () =>
      page.evaluate(() => ({
        stops: window.TabOrderViz!.compute().stops.map((s) => {
          const r = s.element.getBoundingClientRect();
          return `${s.index} ${s.label} @ ${r.x},${r.y},${r.width}x${r.height}`;
        }),
        doc: `${document.documentElement.scrollWidth}x${document.documentElement.scrollHeight}`,
      }));
    const before = await snapshot();
    await page.evaluate(() => window.TabOrderViz!.show());
    await expect(page.getByRole('region', { name: 'Tab order visualizer' })).toBeVisible();
    await expect(page.getByRole('status').first()).toHaveText(/Tab stops/);
    expect(await snapshot()).toEqual(before);
  });

  test('draws one badge per stop, isolated from page CSS', async ({ page }) => {
    await page.goto('/demo/index.html');
    const count = await page.evaluate(() => window.TabOrderViz!.compute().stops.length);
    await page.evaluate(() => window.TabOrderViz!.show());
    // The demo page has `.badge { display: none !important }` and `button { font-size: 30px }`.
    const badges = page.locator('tab-order-viz .badge');
    await expect(badges).toHaveCount(count);
    await expect(badges.first()).toBeVisible();
    await expect(badges.first()).toHaveCSS('font-size', '12px');
    await expect(page.getByRole('button', { name: 'Hide overlay' })).toHaveCSS('font-size', '13px');
    await expect(page.getByRole('status').first()).toHaveText(`${count} Tab stops, 2 focusable but not visible.`);
  });

  test('panel hides, shows and closes the overlay', async ({ page }) => {
    await page.goto('/demo/index.html');
    await page.evaluate(() => window.TabOrderViz!.show());
    const badge = page.locator('tab-order-viz .badge').first();
    await page.getByRole('button', { name: 'Hide overlay' }).click();
    await expect(badge).toBeHidden();
    await page.getByRole('button', { name: 'Show overlay' }).click();
    await expect(badge).toBeVisible();
    await page.getByRole('button', { name: 'Close' }).click();
    await expect(page.locator('tab-order-viz')).toHaveCount(0);
  });
});

test.describe('bookmarklet', () => {
  test('runs, styles itself and toggles on a strict-CSP page', async ({ page }) => {
    // Note: page.evaluate is not itself subject to the page's script-src, so this does NOT prove
    // the browser lets a javascript: bookmark run here. It proves that once running, the tool's
    // own DOM building and styling survive default-src 'none', style-src 'self' and Trusted Types.
    const url = await readFile('dist/bookmarklet.txt', 'utf8');
    const code = decodeURIComponent(url.slice('javascript:'.length));
    await page.goto('/demo/csp.html');
    await page.evaluate(code);
    await expect(page.getByRole('region', { name: 'Tab order visualizer' })).toBeVisible();
    await expect(page.getByRole('status').first()).toHaveText('3 Tab stops.');
    await expect(page.locator('tab-order-viz .badge').first()).toHaveCSS('border-radius', '11px');
    await page.evaluate(code); // second click closes
    await expect(page.locator('tab-order-viz')).toHaveCount(0);
  });
});
