/**
 * TEMPORARY diagnostic (remove after use): Firefox's content process segfaults in CI when the
 * overlay opens right after every stop's position has been read. Each test below performs that
 * read, then exercises one candidate trigger in a fresh page, to see which one crashes.
 */
import { test, expect, type Page } from '@playwright/test';
import type {} from '../src/main';

async function readAllPositions(page: Page) {
  await page.goto('/demo/index.html');
  await page.evaluate(() => window.TabOrderViz!.compute().stops.map((s) => s.element.getBoundingClientRect().x));
}

async function stillAlive(page: Page) {
  await expect.poll(() => page.evaluate(() => document.readyState)).toBe('complete');
  await expect.poll(() => page.evaluate(() => 1 + 1)).toBe(2);
}

const axeRun = (page: Page, rules: string[]) =>
  page.evaluate(async (rules) => {
    const axe = (window as unknown as { axe: { run: (c: unknown, o: unknown) => Promise<unknown> } }).axe;
    await axe.run(document, { runOnly: { type: 'rule', values: rules } });
  }, rules);

test.describe('firefox crash bisect', () => {
  test('control: open overlay without reading positions first', { tag: ['@cross-browser', '@bisect'] }, async ({ page }) => {
    await page.goto('/demo/index.html');
    await page.evaluate(() => window.TabOrderViz!.show());
    await stillAlive(page);
  });
  test('read positions, then scan() only (no overlay)', { tag: ['@cross-browser', '@bisect'] }, async ({ page }) => {
    await readAllPositions(page);
    await page.evaluate(() => window.TabOrderViz!.scan());
    await stillAlive(page);
  });
  test('read positions, then open overlay with axe-core disabled', { tag: ['@cross-browser', '@bisect'] }, async ({ page }) => {
    await readAllPositions(page);
    await page.evaluate(() => {
      delete (window as unknown as { __tovAxeRunner?: unknown }).__tovAxeRunner;
      window.TabOrderViz!.show();
    });
    await stillAlive(page);
  });
  // Round 2: the full overlay, with axe-core limited to one rule set (swapped-in runner).
  for (const rules of [['region'], ['landmark-unique'], ['landmark-one-main'],
    ['tabindex', 'heading-order', 'page-has-heading-one', 'empty-heading', 'bypass', 'scrollable-region-focusable', 'frame-focusable-content']]) {
    test(`read all rects and labels, then overlay with axe rules: ${rules.join(', ')}`, { tag: ['@cross-browser', '@bisect'] }, async ({ page }) => {
      await page.goto('/demo/index.html');
      await page.evaluate(() => window.TabOrderViz!.compute().stops.map((s) => {
        const r = s.element.getBoundingClientRect();
        return `${s.index} ${s.label} @ ${r.x},${r.y},${r.width}x${r.height}`;
      }));
      await page.evaluate((rules) => {
        const w = window as unknown as { axe: { run: (c: unknown, o: unknown) => Promise<unknown> }; __tovAxeRunner: () => Promise<unknown[]> };
        w.__tovAxeRunner = async () => {
          await w.axe.run({ exclude: [['tab-order-viz']] }, { runOnly: { type: 'rule', values: rules } });
          return [];
        };
        window.TabOrderViz!.show();
      }, rules);
      await expect(page.getByRole('region', { name: 'Tab order visualizer' }).getByRole('status').first()).toHaveText(/Tab stops/);
      await stillAlive(page);
    });
  }
  for (const rules of [['region'], ['landmark-unique'], ['landmark-one-main'],
    ['tabindex', 'heading-order', 'page-has-heading-one', 'empty-heading', 'bypass', 'scrollable-region-focusable', 'frame-focusable-content']]) {
    test(`read positions, then axe-core rules: ${rules.join(', ')}`, { tag: ['@cross-browser', '@bisect'] }, async ({ page }) => {
      await readAllPositions(page);
      await axeRun(page, rules);
      await stillAlive(page);
    });
  }
});
