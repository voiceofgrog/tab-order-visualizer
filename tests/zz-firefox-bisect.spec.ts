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
  for (const rules of [['region'], ['landmark-unique'], ['landmark-one-main'],
    ['tabindex', 'heading-order', 'page-has-heading-one', 'empty-heading', 'bypass', 'scrollable-region-focusable', 'frame-focusable-content']]) {
    test(`read positions, then axe-core rules: ${rules.join(', ')}`, { tag: ['@cross-browser', '@bisect'] }, async ({ page }) => {
      await readAllPositions(page);
      await axeRun(page, rules);
      await stillAlive(page);
    });
  }
});
