/**
 * The tool must itself be accessible: keyboard operable, readable contrast, no colour-only
 * meaning, and calm under prefers-reduced-motion.
 */
import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import type {} from '../src/main';

const panelOf = (page: import('@playwright/test').Page) => page.getByRole('region', { name: 'Tab order visualizer' });

async function open(page: import('@playwright/test').Page) {
  await page.goto('/demo/good.html');
  await page.evaluate(() => window.TabOrderViz!.show());
  await expect(panelOf(page).getByRole('status').first()).toHaveText(/Tab stops/);
}

test.describe('keyboard operation', () => {
  test('opening the tool puts keyboard focus in the panel', { tag: '@cross-browser' }, async ({ page }) => {
    await open(page);
    await expect(panelOf(page)).toBeFocused();
  });

  test('shortcut and Escape move between the page and the panel', { tag: '@cross-browser' }, async ({ page }) => {
    await open(page);
    await page.getByRole('link', { name: 'fees' }).focus();
    await page.keyboard.press('Alt+Shift+T');
    await expect(panelOf(page)).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('link', { name: 'fees' })).toBeFocused();
    await page.keyboard.press('Alt+Shift+T');
    await page.keyboard.press('Alt+Shift+T');
    await expect(page.getByRole('link', { name: 'fees' })).toBeFocused();
  });

  test('every panel control is reachable with Tab, and Refresh keeps focus', { tag: '@cross-browser' }, async ({ page, browserName }) => {
    test.skip(browserName === 'webkit', 'Default Safari tabs only to text fields and menus (Option+Tab reaches buttons)');
    await open(page);
    const names: string[] = [];
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press('Tab');
      const name = await page.evaluate(() => {
        let a: Element | null = document.activeElement;
        while (a?.shadowRoot?.activeElement) a = a.shadowRoot.activeElement;
        return a?.closest('tab-order-viz') || (a?.getRootNode() as ShadowRoot)?.host?.localName === 'tab-order-viz'
          ? (a!.getAttribute('aria-label') ?? (a as HTMLInputElement).labels?.[0]?.textContent ?? a!.textContent ?? '').trim()
          : null;
      });
      if (name === null) break;
      names.push(name);
    }
    for (const n of ['Real order', 'Arrows', 'Next stop', 'Pick on page', 'Refresh', 'Move panel', 'Close']) {
      expect(names.some((x) => x.includes(n)), `${n} reachable by Tab; got ${names.join(' | ')}`).toBe(true);
    }
    const refresh = panelOf(page).getByRole('button', { name: 'Refresh' });
    await refresh.focus();
    await page.keyboard.press('Enter');
    await expect(panelOf(page).getByRole('status').first()).toHaveText(/Tab stops/);
    await expect(refresh).toBeFocused();
  });

  test('closing from the panel returns focus to the page', { tag: '@cross-browser' }, async ({ page }) => {
    await page.goto('/demo/good.html');
    await page.getByRole('link', { name: 'fees' }).focus();
    await page.evaluate(() => window.TabOrderViz!.show());
    await expect(panelOf(page)).toBeFocused();
    await panelOf(page).getByRole('button', { name: 'Close' }).press('Enter');
    await expect(page.getByRole('link', { name: 'fees' })).toBeFocused();
  });
});

test.describe('the panel passes axe-core', () => {
  for (const scheme of ['light', 'dark'] as const) {
  test(`no WCAG A/AA violations inside the overlay (${scheme} mode), including colour contrast`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await open(page);
    await panelOf(page).getByText('Fail', { exact: false }).count(); // ensure issues list rendered
    const violations = await page.evaluate(async () => {
      const axe = (window as unknown as { axe: { run: (c: unknown, o: unknown) => Promise<{ violations: { id: string; nodes: unknown[] }[] }> } }).axe;
      const r = await axe.run({ include: [['tab-order-viz']] }, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } });
      return r.violations.map((v) => `${v.id} (${v.nodes.length})`);
    });
    expect(violations).toEqual([]);
  });
  }
});

test.describe('panel header', () => {
  test('minimise collapses the panel to its header and expand restores it', async ({ page }) => {
    await open(page);
    const panel = panelOf(page);
    await panel.getByRole('button', { name: 'Minimise panel' }).click();
    await expect(panel.getByRole('button', { name: 'Next stop' })).toBeHidden();
    await expect(panel.getByRole('button', { name: 'Expand panel' })).toHaveAttribute('aria-expanded', 'false');
    await panel.getByRole('button', { name: 'Expand panel' }).click();
    await expect(panel.getByRole('button', { name: 'Next stop' })).toBeVisible();
  });

  test('severity chips summarise the issues in words', async ({ page }) => {
    await page.goto('/demo/index.html');
    await page.evaluate(() => window.TabOrderViz!.show());
    const panel = panelOf(page);
    await expect(panel.getByRole('status').first()).toHaveText(/Tab stops/);
    await expect(panel.getByText(/^\d+ Fail$/)).toBeVisible();
    await expect(panel.getByText(/^\d+ Review$/)).toBeVisible();
    await expect(panel.getByText(/^\d+ Advice$/)).toBeVisible();
  });

  test('footer shows the version and links to the site for updates', async ({ page }) => {
    const { version } = JSON.parse(await readFile('package.json', 'utf8'));
    await open(page);
    await expect(panelOf(page).getByText(`Version ${version} ·`)).toBeVisible();
    await expect(panelOf(page).getByRole('link', { name: 'Check for a newer version' })).toHaveAttribute(
      'href', 'https://voiceofgrog.github.io/tab-order-visualizer/',
    );
  });

  test('a clean page says so', async ({ page }) => {
    await open(page);
    await expect(panelOf(page).getByText('No issues found by the automated checks')).toBeVisible();
  });
});

test.describe('colour presets', () => {
  // WCAG contrast: text >= 4.5:1, graphics (arrows, outlines against their halo) >= 3:1.
  test('every preset has readable badge text and visible arrows', async () => {
    const config = JSON.parse(await readFile('config/defaults.json', 'utf8'));
    const failures: string[] = [];
    for (const [id, p] of Object.entries<Record<string, string>>(config.display.palettes)) {
      const checks: [string, string, string, number][] = [
        ['real badge text', p.realText, p.real, 4.5],
        ['suggested badge text', p.suggestedText, p.suggested, 4.5],
        ['real arrow vs halo', p.real, p.halo, 3],
        ['suggested arrow vs halo', p.suggested, p.halo, 3],
      ];
      for (const [what, a, b, min] of checks) {
        const ratio = contrast(a, b);
        if (ratio < min) failures.push(`${id}: ${what} ${ratio.toFixed(2)} < ${min}`);
      }
    }
    expect(failures).toEqual([]);
  });
});

test.describe('reduced motion', () => {
  test('step-through jumps instantly instead of smooth scrolling', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/demo/index.html');
    await page.evaluate(() => window.TabOrderViz!.show());
    await expect(panelOf(page).getByRole('status').first()).toHaveText(/Tab stops/);
    const panel = panelOf(page);
    for (let i = 0; i < 20; i++) await panel.getByRole('button', { name: 'Next stop' }).click();
    // Right after the click (no waiting), the target is already in view: no animated scroll.
    const inView = await page.evaluate(() => {
      const r = [...document.querySelectorAll('a')].find((a) => a.textContent === 'Link after the trap')!.getBoundingClientRect();
      return r.top >= 0 && r.bottom <= innerHeight;
    });
    expect(inView).toBe(true);
  });
});

function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r, g, b2] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b2;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
