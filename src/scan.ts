/**
 * One full scan: Tab order -> focus measurements -> suggested order -> issues (ours + axe).
 */
import config from '../config/defaults.json';
import { duplicateLandmarkIssues, emptyProbe, ownIssues, probeFocus, regionIssues } from './checks';
import { computeRegions } from './regions';
import { computeOrder, labelOf } from './order';
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
  const order = orderRespectingScriptModal();
  const probe = config.checks.measureFocus ? probeFocus(order.stops) : emptyProbe();
  for (const s of probe.visibleOnFocus) {
    s.hidden = null;
    s.reasons = s.reasons.filter((r) => !r.startsWith('Focusable but not visible'));
    s.reasons.push('It is hidden until focused, then appears (the usual skip-link pattern). That is fine.');
  }
  const suggested = suggestOrder(order.stops);
  const announcements = new Map(order.stops.map((s) => [s, announce(s)]));
  const { issues, jumps } = ownIssues(order, suggested, probe);
  // The Firefox bookmarklet build leaves the Region view out (bookmark size limit).
  const regions = __LITE__ ? { regions: [], segments: [], outside: 0 } : computeRegions(order.stops);
  if (!__LITE__) issues.push(...regionIssues(regions, order.stops.length), ...duplicateLandmarkIssues(regions));

  let axeIssues: Issue[] = [];
  let axe: ScanResult['axe'] = 'not-included';
  let axeMessage: string | undefined;
  // The full build registers an axe runner; the bookmarklet build has none (keeps it small).
  const runAxe = (window as unknown as { __tovAxeRunner?: () => Promise<Issue[]> }).__tovAxeRunner;
  if (runAxe) {
    try {
      axeIssues = await runAxe();
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
  return { order, suggested, issues: all, jumps, announcements, regions, axe, axeMessage };
}

/**
 * Native <dialog> modals are handled by computeOrder (the browser makes the rest inert).
 * Many sites instead build modals from a <div role="dialog" aria-modal="true"> and keep
 * focus inside with script (cookie banners, for example). If such a dialog is visible and
 * its script really cancels Tab, only the dialog is reachable, so only it is analysed.
 */
function orderRespectingScriptModal() {
  if (!config.checks.probeTabKey) return computeOrder();
  const dialogs = Array.from(document.querySelectorAll('[aria-modal="true"]')).filter((d) => {
    if (!d.matches('[role=dialog], [role=alertdialog], dialog')) return false;
    const r = d.getBoundingClientRect();
    return (typeof d.checkVisibility !== 'function' || d.checkVisibility()) && r.width > 0 && r.height > 0;
  });
  const dialog = dialogs[dialogs.length - 1];
  if (!dialog) return computeOrder();
  const name = labelOf(dialog);
  if (scriptKeepsFocusInside(dialog)) {
    const order = computeOrder(dialog);
    order.notes.unshift(
      `A modal dialog ("${name}") is open and its script keeps keyboard focus inside it, so only the dialog is analysed. ` +
        'Keyboard users must deal with it before reaching the page. Close it, then press Refresh to see the rest of the page.',
    );
    return order;
  }
  const order = computeOrder();
  order.notes.unshift(
    `A dialog ("${name}") is marked aria-modal="true", but keyboard focus can leave it. ` +
      'Screen readers may hide the rest of the page while Tab still reaches it, which is confusing.',
  );
  return order;
}

/** Sends a simulated Tab from the dialog's last stop and Shift+Tab from its first. */
function scriptKeepsFocusInside(dialog: Element): boolean {
  const stops = computeOrder(dialog).stops;
  if (!stops.length) return false;
  const previous = document.activeElement as HTMLElement | null;
  const sx = window.scrollX;
  const sy = window.scrollY;
  const tryKey = (el: Element, shift: boolean) => {
    (el as HTMLElement).focus?.({ preventScroll: true });
    const ev = new KeyboardEvent('keydown', { key: 'Tab', code: 'Tab', shiftKey: shift, bubbles: true, cancelable: true, composed: true });
    for (const p of ['keyCode', 'which']) Object.defineProperty(ev, p, { get: () => 9 });
    el.dispatchEvent(ev);
    return ev.defaultPrevented;
  };
  try {
    return tryKey(stops[stops.length - 1].element, false) && tryKey(stops[0].element, true);
  } finally {
    if (previous && previous !== document.body) previous.focus({ preventScroll: true });
    else (document.activeElement as HTMLElement | null)?.blur?.();
    window.scrollTo(sx, sy);
  }
}
