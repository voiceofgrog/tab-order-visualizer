/**
 * Read-only check of the tool against a real page:
 *  1. Load the page (no clicks, no form input, consent banners left alone).
 *  2. Inject the full build the way the extension does (page.evaluate is not blocked by the
 *     page's Content Security Policy, and does not change it).
 *  3. Ask the tool for its Tab order, then press Tab and record where focus really goes.
 *  4. Write a report to reports/ (git-ignored) and a screenshot with the overlay.
 *
 * Tab presses inside a cross-origin iframe (ads, embeds) leave the parent page's
 * activeElement on the <iframe>, so consecutive presses on the same frame are collapsed.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import type {} from '../src/main';

const URL_TO_TEST = process.env.VALIDATE_URL ?? 'https://example.edu/';
const MAX_PRESSES = Number(process.env.VALIDATE_MAX_PRESSES ?? 250);

test(`tool order vs real Tab presses on ${URL_TO_TEST}`, async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto(URL_TO_TEST, { waitUntil: 'load' });
  await page.evaluate(await readFile('dist/tov-full.js', 'utf8'));
  await expect.poll(() => page.evaluate(() => typeof window.TabOrderViz)).toBe('object');

  const tool = await page.evaluate(async () => {
    const r = (await window.TabOrderViz!.scan()).order;
    (window as unknown as { __stops: Element[] }).__stops = r.stops.map((s) => s.element);
    return { labels: r.stops.map((s) => `${s.label} <${s.element.localName}>`), kinds: r.stops.map((s) => s.kind), notes: r.notes, skipped: r.skipped.length };
  });

  const presses = Math.min(tool.labels.length + 20, MAX_PRESSES);
  const actual: { i: number; desc: string }[] = [];
  for (let n = 0; n < presses; n++) {
    await page.keyboard.press('Tab');
    const hit = await page.evaluate(() => {
      let a: Element | null = document.activeElement;
      while (a?.shadowRoot?.activeElement) a = a.shadowRoot.activeElement;
      if (!a || a === document.body) return { i: -2, desc: 'BODY' };
      const i = (window as unknown as { __stops: Element[] }).__stops.indexOf(a);
      const text = (a.getAttribute('aria-label') ?? a.textContent ?? a.getAttribute('title') ?? '').replace(/\s+/g, ' ').trim().slice(0, 50);
      return { i, desc: `${text} <${a.localName}${a.id ? '#' + a.id : ''}>` };
    });
    const last = actual[actual.length - 1];
    if (last && last.i === hit.i && last.desc === hit.desc) continue; // still inside the same iframe
    actual.push(hit);
    if (hit.i === -2 && n > 5) break; // focus left the page: one full pass done
  }

  // How well do the sequences agree? Longest common subsequence of tool indices.
  const seq = actual.filter((a) => a.i >= 0).map((a) => a.i);
  const expected = tool.labels.map((_, i) => i);
  const lcs = lcsLength(expected, seq);
  let prefix = 0;
  while (prefix < seq.length && seq[prefix] === prefix) prefix++;
  const unlisted = actual.filter((a) => a.i === -1).map((a) => a.desc);
  const visited = new Set(seq);
  const neverReached = expected.filter((i) => !visited.has(i)).map((i) => `${i + 1}. ${tool.labels[i]} (${tool.kinds[i]})`);
  const firstDivergence = prefix < actual.length ? {
    atPress: prefix + 1,
    toolExpected: tool.labels[prefix] ? `${prefix + 1}. ${tool.labels[prefix]}` : '(end of tool list)',
    browserWent: actual.filter((a) => a.i !== -2)[prefix]?.desc ?? '(left page)',
  } : null;

  const scan = await page.evaluate(async () => {
    const s = await window.TabOrderViz!.scan();
    return {
      axe: s.axe,
      issues: s.issues.map((i) => `${i.severity} ${i.title}${i.elements.length > 1 ? ` (${i.elements.length})` : ''}`),
      suggestedLength: s.suggested.length,
    };
  });

  const report = {
    url: URL_TO_TEST,
    when: new Date().toISOString(),
    toolStops: tool.labels.length,
    toolSkipped: tool.skipped,
    toolNotes: tool.notes,
    browserStopsSeen: actual.filter((a) => a.i !== -2).length,
    agreement: { commonSubsequence: lcs, exactPrefix: prefix, unlistedCount: unlisted.length, neverReachedCount: neverReached.length },
    firstDivergence,
    unlisted: unlisted.slice(0, 40),
    neverReached: neverReached.slice(0, 40),
    browserSequence: actual.map((a) => (a.i >= 0 ? `#${a.i + 1}` : a.i === -1 ? `UNLISTED ${a.desc}` : 'BODY')).slice(0, 300),
    scan,
  };
  const host = new URL(URL_TO_TEST).hostname.replace(/[^a-z0-9.-]/gi, '_');
  await mkdir('reports', { recursive: true });
  await writeFile(`reports/validation-${host}.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, browserSequence: undefined, unlisted: report.unlisted.slice(0, 15), neverReached: report.neverReached.slice(0, 15) }, null, 2));

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.evaluate(() => window.TabOrderViz!.show());
  await expect(page.getByRole('region', { name: 'Tab order visualizer' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Tab order visualizer' }).getByRole('status').first()).toHaveText(/Tab stop/);
  await page.screenshot({ path: `reports/validation-${host}.png` });
});

function lcsLength(a: number[], b: number[]): number {
  const dp = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    let prev = 0;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev + 1 : Math.max(dp[j], dp[j - 1]);
      prev = tmp;
    }
  }
  return dp[b.length];
}
