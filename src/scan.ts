/**
 * One full scan: Tab order -> focus measurements -> suggested order -> issues (ours + axe).
 */
import config from '../config/defaults.json';
import { getAxe, runAxe } from './axe';
import { emptyProbe, ownIssues, probeFocus } from './checks';
import { computeOrder } from './order';
import { suggestOrder } from './suggest';
import { announce } from './time';
import type { Issue, ScanResult, Severity } from './types';

const SEVERITY_RANK: Record<Severity, number> = { fail: 0, review: 1, advice: 2 };
let running: Promise<ScanResult> | null = null;

/** Concurrent calls share one scan (axe-core refuses to run twice at once). */
export function scan(): Promise<ScanResult> {
  running ??= doScan().finally(() => (running = null));
  return running;
}

async function doScan(): Promise<ScanResult> {
  const order = computeOrder();
  const probe = config.checks.measureFocus ? probeFocus(order.stops) : emptyProbe();
  for (const s of probe.visibleOnFocus) {
    s.hidden = null;
    s.reasons = s.reasons.filter((r) => !r.startsWith('Focusable but not visible'));
    s.reasons.push('It is hidden until focused, then appears (the usual skip-link pattern). That is fine.');
  }
  const suggested = suggestOrder(order.stops);
  const announcements = new Map(order.stops.map((s) => [s, announce(s)]));
  const { issues, jumps } = ownIssues(order, suggested, probe);

  let axeIssues: Issue[] = [];
  let axe: ScanResult['axe'] = 'not-included';
  let axeMessage: string | undefined;
  const engine = getAxe();
  if (engine) {
    try {
      axeIssues = await runAxe(engine);
      axe = 'ran';
    } catch (e) {
      axe = 'error';
      axeMessage = e instanceof Error ? e.message : String(e);
    }
  }
  // If axe reports a real bypass failure, our softer "no skip link" advice is redundant.
  const all = axeIssues.some((i) => i.rule === 'bypass')
    ? [...issues.filter((i) => i.rule !== 'no-skip-link'), ...axeIssues]
    : [...issues, ...axeIssues];
  all.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
  return { order, suggested, issues: all, jumps, announcements, axe, axeMessage };
}
