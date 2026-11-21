import { test, expect, type Page } from '@playwright/test';
import type {} from '../src/main';

/** Scans in the page and returns issues as "severity source:rule [labels]" strings. */
async function scanIssues(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const s = await window.TabOrderViz!.scan();
    return s.issues.map((i) => `${i.severity} ${i.source}:${i.rule} [${i.labels.join(' | ')}]`);
  });
}

/** Labels of every item the tool says is entirely covered when focused. */
async function toolCovered(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const s = await window.TabOrderViz!.scan();
    return s.issues.filter((i) => i.rule === 'focus-obscured').flatMap((i) => i.labels).sort();
  });
}

/**
 * Presses a key repeatedly and, after each press, checks five points on the focused element.
 * Returns labels of elements that were entirely covered by something else. This is the
 * ground truth: real key presses, real browser scrolling.
 */
async function realCovered(page: Page, key: 'Tab' | 'Shift+Tab', presses: number): Promise<string[]> {
  const covered = new Set<string>();
  for (let i = 0; i < presses; i++) {
    await page.keyboard.press(key);
    await scrollSettled(page);
    const hit = await page.evaluate(() => {
      let a: Element | null = document.activeElement;
      while (a?.shadowRoot?.activeElement) a = a.shadowRoot.activeElement;
      if (!a || a === document.body) return null;
      const r = a.getBoundingClientRect();
      const l = Math.max(r.left, 0), rt = Math.min(r.right, innerWidth);
      const t = Math.max(r.top, 0), b = Math.min(r.bottom, innerHeight);
      // Invisible stops are reported as a separate (worse) problem, and an element with no
      // on-screen area cannot be "covered", so both are outside this check.
      const stop = window.TabOrderViz!.compute().stops.find((s) => s.element === a);
      if (!stop || stop.hidden || rt - l < 1 || b - t < 1) return null;
      // Same measurement as the tool: centre plus 20%/80% points (inside rounded shapes).
      const x = (f: number) => l + (rt - l) * f, y = (f: number) => t + (b - t) * f;
      const pts = [[x(0.5), y(0.5)], [x(0.2), y(0.2)], [x(0.8), y(0.2)], [x(0.2), y(0.8)], [x(0.8), y(0.8)]];
      const inside = (h: Element | null) => {
        for (let n: Node | null = h; n; n = n.parentNode ?? (n as ShadowRoot).host ?? null) if (n === a) return true;
        for (let n: Node | null = a; n; n = n.parentNode ?? (n as ShadowRoot).host ?? null) if (n === h) return true;
        return false;
      };
      const all = pts.every(([x, y]) => !inside(document.elementFromPoint(x, y)));
      return all ? stop.label : null;
    });
    if (hit) covered.add(hit);
  }
  return [...covered].sort();
}

/**
 * Waits until the page's scroll position stops changing. Some engines (WebKit on macOS) animate
 * the scroll that follows a Tab press; measuring mid-animation made the ground truth vary run to run.
 * This waits on the condition itself (two equal readings in a row), not for a fixed time.
 */
async function scrollSettled(page: Page): Promise<void> {
  let last = '';
  await expect
    .poll(async () => {
      const now = await page.evaluate(() => `${scrollX},${scrollY}`);
      const settled = now === last;
      last = now;
      return settled;
    }, { intervals: [50, 50, 100, 100, 200] })
    .toBe(true);
}

test.describe('issues on the broken demo', () => {
  test('finds the planted problems', async ({ page }) => {
    await page.goto('/demo/index.html');
    const issues = await scanIssues(page);
    expect(issues).toEqual(
      expect.arrayContaining([
        'fail tool:focusable-invisible [Offscreen promo link | Invisible button]',
        'fail tool:keyboard-trap [Notes editor]',
        'review tool:order-jump [Search the site | Contact]',
        'review tool:order-jump [Contact | News]',
        'review tool:order-jump [Card A details | Card B details]',
        'review tool:order-jump [Widget tabindex 1 | Widget first in source]',
        'review axe:tabindex [Contact | Search the site | Widget tabindex 1]',
        'advice tool:multiple-h1 [Welcome to the demo | A second top-level heading]',
        'advice tool:no-skip-link [Search the site]',
        'advice axe:heading-order [Skipped heading levels]',
      ]),
    );
    expect(issues.some((i) => i.startsWith('fail tool:focus-obscured'))).toBe(true);
    // Only the planted trap: no other element cancels Tab.
    expect(issues.filter((i) => i.includes('keyboard-trap'))).toHaveLength(1);
    // The page has landmarks and headings, so axe's bypass rule passes; we give advice instead.
    expect(issues.some((i) => i.includes('axe:bypass'))).toBe(false);
  });

  test('scan leaves scroll position and focus as it found them', { tag: '@cross-browser' }, async ({ page }) => {
    await page.goto('/demo/index.html');
    await page.getByRole('link', { name: 'Card B details' }).focus();
    const before = await page.evaluate(() => scrollY);
    await page.evaluate(() => window.TabOrderViz!.scan());
    await expect(page.getByRole('link', { name: 'Card B details' })).toBeFocused();
    expect(await page.evaluate(() => scrollY)).toBe(before);
  });

  test('covered-focus check agrees with real Tab and Shift+Tab presses', { tag: '@cross-browser' }, async ({ page }) => {
    await page.goto('/demo/index.html?trap=off');
    const n = await page.evaluate(() => window.TabOrderViz!.compute().stops.length);
    const tool = await toolCovered(page);
    const forwardTruth = await realCovered(page, 'Tab', n);

    await page.goto('/demo/index.html?trap=off');
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const backwardTruth = await realCovered(page, 'Shift+Tab', n);

    expect(tool).toEqual([...new Set([...forwardTruth, ...backwardTruth])].sort());
  });

  test('suggested order follows the visual layout', async ({ page }) => {
    await page.goto('/demo/index.html');
    const suggested = await page.evaluate(async () => (await window.TabOrderViz!.scan()).suggested.map((s) => s.label));
    expect(suggested.slice(0, 8)).toEqual([
      'News', 'Events', 'Contact', 'Search the site', 'Read more about this page',
      'Card B details', 'Card C details', 'Card A details',
    ]);
    expect(suggested).not.toContain('Offscreen promo link');
  });
});

test.describe('false-positive check on the well-built demo', () => {
  test('reports no issues and no backward jumps', async ({ page }) => {
    await page.goto('/demo/good.html');
    const result = await page.evaluate(async () => {
      const s = await window.TabOrderViz!.scan();
      return { issues: s.issues.map((i) => i.title), jumps: s.jumps.size, axe: s.axe };
    });
    expect(result).toEqual({ issues: [], jumps: 0, axe: 'ran' });
  });

  test('in Safari the skip link is skipped by Tab, and the tool explains why', { tag: '@cross-browser' }, async ({ page, browserName }) => {
    test.skip(browserName !== 'webkit', 'Safari-specific behaviour');
    await page.goto('/demo/good.html');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('searchbox', { name: 'Search the site' })).toBeFocused();
    const skipped = await page.evaluate(() => window.TabOrderViz!.compute().skipped.find((s) => s.label === 'Skip to main content'));
    expect(skipped?.code).toBe('safari-default');
  });

  test('skip link counts as visible because it appears on focus', { tag: '@cross-browser' }, async ({ page, browserName }) => {
    test.skip(browserName === 'webkit', 'Safari skips links by default; covered by the Safari test above');
    await page.goto('/demo/good.html');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeFocused();
    await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeInViewport();
    const first = await page.evaluate(async () => (await window.TabOrderViz!.scan()).order.stops[0]);
    expect(first.hidden).toBeNull();
  });
});

test.describe('script-managed modal dialog (like a cookie banner)', () => {
  test('only the dialog is analysed when its script keeps focus inside', async ({ page }) => {
    await page.goto('/demo/modal.html');
    const r = await page.evaluate(async () => {
      const s = await window.TabOrderViz!.scan();
      return { labels: s.order.stops.map((x) => x.label), notes: s.order.notes, issues: s.issues.map((i) => `${i.rule} (${i.elements.length})`) };
    });
    expect(r.labels).toEqual(['Privacy policy', 'Reject non-essential', 'Accept cookies']);
    expect(r.notes[0]).toMatch(/^A modal dialog \("Privacy"\) is open and its script keeps keyboard focus inside it/);
    expect(r.issues).toContain('tab-managed (3)');
    expect(r.issues.filter((i) => i.startsWith('keyboard-trap'))).toEqual([]);

    await page.evaluate(() => window.TabOrderViz!.show());
    await expect(page.getByRole('region', { name: 'Tab order visualizer' }).getByText(/^A modal dialog \("Privacy"\) is open/)).toBeVisible();

    // Ground truth: real Tab presses cycle through exactly those three.
    const seen: string[] = [];
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press('Tab');
      seen.push(await page.evaluate(() => document.activeElement?.textContent?.trim() ?? ''));
    }
    expect(seen).toEqual(['Privacy policy', 'Reject non-essential', 'Accept cookies', 'Privacy policy']);
  });

  test('a dialog marked modal without a focus trap is reported, not assumed', async ({ page }) => {
    await page.goto('/demo/modal.html?trap=off');
    const r = await page.evaluate(async () => {
      const s = await window.TabOrderViz!.scan();
      return { count: s.order.stops.length, notes: s.order.notes };
    });
    expect(r.count).toBe(5);
    expect(r.notes[0]).toMatch(/marked aria-modal="true", but keyboard focus can leave it/);
  });
});

test.describe('panel controls', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/demo/index.html');
    await page.evaluate(() => window.TabOrderViz!.show());
    await expect(page.getByRole('status').first()).toHaveText(/Tab stops/);
  });

  test('switching to the suggested order shows square badges instead', async ({ page }) => {
    await page.getByRole('radio', { name: 'Suggested order' }).check();
    await expect(page.locator('tab-order-viz .sbadge')).toHaveCount(21);
    await expect(page.locator('tab-order-viz .sbadge').first()).toBeVisible();
    await expect(page.locator('tab-order-viz .badge').first()).toBeHidden();
    await page.getByRole('radio', { name: 'Both' }).check();
    await expect(page.locator('tab-order-viz .badge').first()).toBeVisible();
  });

  test('colour and size settings restyle the badges', async ({ page }) => {
    const badge = page.locator('tab-order-viz .badge').first();
    await page.getByRole('combobox', { name: 'Colours' }).selectOption('contrast');
    await expect(badge).toHaveCSS('background-color', 'rgb(0, 0, 0)');
    await expect(badge).toHaveCSS('color', 'rgb(255, 255, 0)');
    await page.getByRole('combobox', { name: 'Size' }).selectOption('large');
    await expect(badge).toHaveCSS('font-size', '16px');
  });

  test('step-through explains each stop', async ({ page }) => {
    await page.getByRole('button', { name: 'Next stop' }).click();
    await expect(page.getByText(/^Stop 1 of 23: Search the site\. tabindex="1"/)).toBeVisible();
    await page.getByRole('button', { name: 'Next stop' }).click();
    await expect(page.getByText(/^Stop 2 of 23: Contact\./)).toBeVisible();
  });

  test('issues list shows plain-language fixes and WCAG links', async ({ page }) => {
    // Scope to the panel: the demo page has its own "Keyboard trap" heading.
    const panel = page.getByRole('region', { name: 'Tab order visualizer' });
    await panel.getByText('Fail Keyboard trap', { exact: true }).click();
    await expect(panel.getByText(/^How to fix: Do not cancel the Tab key/)).toBeVisible();
    await expect(panel.getByRole('link', { name: '2.1.2 No Keyboard Trap (A)' })).toHaveAttribute(
      'href', 'https://www.w3.org/WAI/WCAG22/Understanding/no-keyboard-trap.html',
    );
    await panel.getByRole('button', { name: 'Show “Notes editor”' }).click();
    await expect(page.locator('tab-order-viz rect.hl')).toHaveCount(1);
    await expect(page.getByRole('textbox', { name: 'Notes editor' })).toBeInViewport();
  });
});
