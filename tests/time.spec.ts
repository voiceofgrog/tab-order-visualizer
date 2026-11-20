import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import type {} from '../src/main';

interface Profile {
  id: string;
  secondsPerTab: number;
  wordsPerMinute: number | null;
  maxWordsHeard: number | null;
  visualSecondsPerStop: number;
}

test.describe('time model', () => {
  test('totals equal the documented formula, recomputed independently', async ({ page }) => {
    const config = JSON.parse(await readFile('config/defaults.json', 'utf8'));
    const profiles: Profile[] = config.timing.profiles;
    await page.goto('/demo/index.html');
    const { words, estimates } = await page.evaluate(async () => {
      const api = window.TabOrderViz!;
      const s = await api.scan();
      const words = s.order.stops.map((st) => s.announcements.get(st)!.words);
      return { words, estimates: (await api.estimate(words.length)).estimates };
    });
    for (const p of profiles) {
      const cost = (w: number) =>
        p.secondsPerTab + p.visualSecondsPerStop +
        (p.wordsPerMinute ? (Math.min(w, p.maxWordsHeard ?? Infinity) / p.wordsPerMinute) * 60 : 0);
      const expected = words.reduce((t, w) => t + cost(w), 0);
      const got = estimates.find((e) => e.profileId === p.id)!;
      expect(got.total).toBeCloseTo(expected, 6);
      expect(got.reach).toBeCloseTo(expected, 6); // target is the last stop
    }
  });

  test('announcements include name, role and state', async ({ page }) => {
    await page.goto('/demo/index.html');
    const texts = await page.evaluate(async () => {
      const api = window.TabOrderViz!;
      return Promise.all([2, 11, 12, 1].map(async (i) => (await api.estimate(i)).announcement.text));
    });
    expect(texts).toEqual([
      'Contact, link',
      'More options, button, collapsed',
      'Medium, radio button, checked, 2 of 3',
      'Search the site, search edit text',
    ]);
  });

  test('suggested order would reach Card B one stop sooner', async ({ page }) => {
    await page.goto('/demo/index.html');
    const e = await page.evaluate(async () => (await window.TabOrderViz!.estimate(7)).estimates[0]);
    expect(e.reachStops).toBe(7);
    expect(e.suggestedStops).toBe(6);
    expect(e.suggestedReach!).toBeLessThan(e.reach);
  });

  test('skip link savings: missing on the broken demo, present on the good one', async ({ page }) => {
    await page.goto('/demo/index.html');
    const broken = await page.evaluate(async () => (await window.TabOrderViz!.estimate(1)).skip!);
    expect(broken).toMatchObject({ hasSkipLink: false, stopsWithout: 5, pressesWith: 3, target: 'Read more about this page' });
    for (const p of broken.perProfile) expect(p.with).toBeLessThan(p.without);

    await page.goto('/demo/good.html');
    const good = await page.evaluate(async () => (await window.TabOrderViz!.estimate(1)).skip!);
    expect(good).toMatchObject({ hasSkipLink: true, stopsWithout: 6, pressesWith: 3, target: 'how to apply' });
  });
});

test.describe('time panel', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/demo/index.html');
    await page.evaluate(() => window.TabOrderViz!.show());
    await expect(page.getByRole('status').first()).toHaveText(/Tab stops/);
  });

  test('choosing a target shows the estimate for each profile', async ({ page }) => {
    const panel = page.getByRole('region', { name: 'Tab order visualizer' });
    await panel.getByRole('combobox', { name: 'Target' }).selectOption({ label: '7. Card B details' });
    // Sighted keyboard: 0.6 s per Tab + 0.3 s to spot focus = 0.9 s per stop; 7 stops = 6.3 s.
    await expect(panel.getByRole('row', { name: /Sighted keyboard user/ })).toContainText('6.3 s (7 stops)');
    await expect(panel.getByRole('row', { name: /Screen reader, everyday/ })).toBeVisible();
    await expect(panel.getByRole('row', { name: /Screen reader, expert/ })).toBeVisible();
    await expect(panel.getByText(/^Suggested order: 6 stops instead of 7/)).toBeVisible();
    await expect(panel.getByText(/^A skip link would cut reaching/)).toBeVisible();
    await expect(panel.getByText('A model, not a measurement.', { exact: false })).toBeVisible();
  });

  test('picking on the page sets the target without following the link', async ({ page }) => {
    const panel = page.getByRole('region', { name: 'Tab order visualizer' });
    await panel.getByRole('button', { name: 'Pick on page' }).click();
    await page.getByRole('link', { name: 'Card C details' }).click();
    await expect(panel.getByRole('combobox', { name: 'Target' })).toHaveValue('8');
    await expect(panel.getByText('Target set to stop 8: Card C details.')).toBeVisible();
    expect(new URL(page.url()).hash).toBe('');
  });

  test('stepping through moves the target along', async ({ page }) => {
    const panel = page.getByRole('region', { name: 'Tab order visualizer' });
    await panel.getByRole('button', { name: 'Next stop' }).click();
    await panel.getByRole('button', { name: 'Next stop' }).click();
    await expect(panel.getByRole('combobox', { name: 'Target' })).toHaveValue('2');
    await expect(panel.getByText('Announced roughly as “Contact, link” (2 words).')).toBeVisible();
  });
});
