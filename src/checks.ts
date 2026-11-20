/**
 * Our own checks, for things axe-core does not cover.
 *
 * probeFocus() is the only part that touches the page: it focuses each stop to see
 * what the user would see, then restores focus and scroll position. All of it runs
 * synchronously, so the browser never paints the intermediate states. Pages that react
 * to focus events (for example menus that open on focus) will see those events.
 */
import config from '../config/defaults.json';
import { OVERLAY_TAG, composedParent, describe, invisibility, labelOf, type OrderResult, type Stop } from './order';
import type { Issue } from './types';

export interface Probe {
  /** Hidden stops that become visible when focused (skip-link pattern). */
  visibleOnFocus: Set<Stop>;
  /** Stops entirely covered by other content after the browser scrolls them into view. */
  obscured: { stop: Stop; dir: 'backward' | 'forward'; by: Element; entirely: boolean }[];
  /** Stops where page code cancels the Tab key. */
  trapped: { stop: Stop; forward: boolean; backward: boolean; moved: boolean }[];
}

export function emptyProbe(): Probe {
  return { visibleOnFocus: new Set(), obscured: [], trapped: [] };
}

export function probeFocus(stops: Stop[]): Probe {
  const out = emptyProbe();
  const host = document.querySelector(OVERLAY_TAG) as HTMLElement | null;
  host?.style.setProperty('display', 'none', 'important'); // our panel must not count as "covering"
  const sx = window.scrollX;
  const sy = window.scrollY;
  const previous = deepActive();
  try {
    // Walk the stops the way a keyboard user would: forwards from the top of the page, and
    // backwards (Shift+Tab) from the bottom. focus() scrolls the same way Tab does (verified
    // against real key presses in the tests), so each item lands where the user would see it.
    for (const dir of ['forward', 'backward'] as const) {
      window.scrollTo(sx, dir === 'forward' ? 0 : document.documentElement.scrollHeight);
      for (const s of dir === 'forward' ? stops : [...stops].reverse()) {
        const el = s.element as HTMLElement;
        if (typeof el.focus !== 'function') continue;
        if (s.hidden) {
          if (dir !== 'forward') continue;
          el.focus({ preventScroll: true });
          if (deepActive() === el && !invisibility(el)) out.visibleOnFocus.add(s);
          else continue;
        }
        el.focus();
        const cover = coverage(el);
        if (cover) out.obscured.push({ stop: s, dir, ...cover });
      }
    }
    for (const s of stops) {
      const el = s.element as HTMLElement;
      if (typeof el.focus !== 'function') continue;
      if (config.checks.probeTabKey && !isTextEntry(el)) {
        const f = probeTab(el, false);
        const b = probeTab(el, true);
        if (f.prevented || b.prevented) {
          out.trapped.push({ stop: s, forward: f.prevented, backward: b.prevented, moved: f.moved || b.moved });
        }
      }
    }
  } finally {
    window.scrollTo(sx, sy);
    // Show our overlay again *before* restoring focus: if focus was on a panel button
    // (for example Refresh), it cannot be focused while the overlay is display: none.
    host?.style.setProperty('display', 'block', 'important');
    const now = deepActive() as HTMLElement | null;
    if (previous && previous !== document.body) (previous as HTMLElement).focus?.({ preventScroll: true });
    else now?.blur?.();
  }
  return out;
}

/**
 * Checks five sample points on the focused element. If something else is on top at every
 * point, the element is entirely covered (fails 2.4.11 AA); at some points, partly covered
 * (fails 2.4.12 AAA only).
 */
function coverage(el: HTMLElement): { by: Element; entirely: boolean } | null {
  const pts = samplePoints(el.getBoundingClientRect());
  let covered = 0;
  let first: Element | null = null;
  for (const [x, y] of pts) {
    const hit = document.elementFromPoint(x, y);
    if (!hit || related(hit, el)) continue;
    covered++;
    first ??= hit;
  }
  if (!first) return null;
  return { by: positionedAncestor(first) ?? first, entirely: covered === pts.length };
}

/**
 * Centre plus four points at 20% and 80% of the visible box. Points near the corners would
 * fall outside rounded shapes (pills, circles, rounded skip links) and "see" whatever is
 * behind them, which made fully visible items look partly covered. 20/80 stays inside
 * even a circle (distance from centre 0.42 of the diameter).
 */
export function samplePoints(r: DOMRect): [number, number][] {
  const left = Math.max(r.left, 0);
  const right = Math.min(r.right, window.innerWidth);
  const top = Math.max(r.top, 0);
  const bottom = Math.min(r.bottom, window.innerHeight);
  if (right - left < 1 || bottom - top < 1) return [];
  const x = (f: number) => left + (right - left) * f;
  const y = (f: number) => top + (bottom - top) * f;
  return [[x(0.5), y(0.5)], [x(0.2), y(0.2)], [x(0.8), y(0.2)], [x(0.2), y(0.8)], [x(0.8), y(0.8)]];
}

function probeTab(el: HTMLElement, shift: boolean): { prevented: boolean; moved: boolean } {
  el.focus({ preventScroll: true });
  const ev = new KeyboardEvent('keydown', { key: 'Tab', code: 'Tab', shiftKey: shift, bubbles: true, cancelable: true, composed: true });
  for (const p of ['keyCode', 'which']) Object.defineProperty(ev, p, { get: () => 9 });
  el.dispatchEvent(ev);
  return { prevented: ev.defaultPrevented, moved: deepActive() !== el };
}

/** Text fields and editors are skipped: a synthetic Tab could insert a tab character. */
function isTextEntry(el: HTMLElement): boolean {
  if (el.isContentEditable || el instanceof HTMLTextAreaElement) return true;
  return el instanceof HTMLInputElement && !['checkbox', 'radio', 'button', 'submit', 'reset', 'image', 'file', 'color', 'range'].includes(el.type);
}

// ---------------------------------------------------------------------------
// Turning measurements into issues
// ---------------------------------------------------------------------------

export function ownIssues(order: OrderResult, suggested: Stop[], probe: Probe): { issues: Issue[]; jumps: Set<number> } {
  const issues: Issue[] = [];
  const add = (i: Omit<Issue, 'id' | 'source' | 'labels'>) =>
    issues.push({ ...i, id: `tool-${i.rule}-${issues.length}`, source: 'tool', labels: i.elements.map(labelOf) });

  const invisible = order.stops.filter((s) => s.hidden);
  if (invisible.length) {
    const list = invisible.map((s) => `"${s.label}" (${s.hidden})`).join('; ');
    add({
      rule: 'focusable-invisible',
      severity: 'fail',
      title: 'Focusable but invisible',
      summary: `${invisible.length === 1 ? 'This item receives' : `${invisible.length} items receive`} keyboard focus but cannot be seen, even when focused: ${list}. Keyboard users land on them and see nothing; screen reader users hear things sighted users cannot see.`,
      fix: 'If it should be hidden from everyone, use display: none, the hidden attribute or inert. If it is a skip link, make it visible when focused. Otherwise make it visible.',
      wcag: ['2.4.7', '2.4.3'],
      elements: invisible.map((s) => s.element),
    });
  }

  // An item covered entirely in one direction counts as entirely covered, even if only
  // partly covered in the other; group by what covers it.
  const worst = new Map<Stop, (typeof probe.obscured)[number]>();
  for (const o of probe.obscured) {
    const prev = worst.get(o.stop);
    if (!prev || (o.entirely && !prev.entirely)) worst.set(o.stop, o);
  }
  const groups = new Map<string, { entirely: boolean; by: Element; dirs: Set<string>; stops: Stop[] }>();
  for (const o of worst.values()) {
    const key = `${o.entirely}|${describe(o.by)}|${o.by.className}`;
    const g = groups.get(key) ?? { entirely: o.entirely, by: o.by, dirs: new Set(), stops: [] };
    g.dirs.add(o.dir);
    g.stops.push(o.stop);
    groups.set(key, g);
  }
  for (const g of groups.values()) {
    const cover = coverDesc(g.by);
    const n = g.stops.length;
    const when = g.dirs.size > 1 ? 'tabbing in either direction' : g.dirs.has('forward') ? 'tabbing forwards' : 'tabbing backwards (Shift+Tab)';
    const r = g.by.getBoundingClientRect();
    const edge = r.top + r.height / 2 < window.innerHeight / 2 ? 'top' : 'bottom';
    // Scroll padding only helps with content that stays put while the page scrolls.
    const fix = cover.pinned
      ? `Add scroll-padding-${edge} to the html element, at least as tall as ${cover.the} (for example html { scroll-padding-${edge}: ${Math.ceil(r.height) + 10}px; }), so the browser keeps focused items clear of it.` +
        (cover.the.endsWith('element') ? ' For a banner or dialog, also consider letting users dismiss it, or not covering content until they do.' : '')
      : `${cover.the.charAt(0).toUpperCase()}${cover.the.slice(1)} ${describe(g.by)} is drawn on top of ${n === 1 ? 'it' : 'them'}. ` +
        'Look for positioning, negative margins or z-index that make the two overlap, and move or restack them so the focused item is fully visible.';
    add({
      rule: g.entirely ? 'focus-obscured' : 'focus-partly-obscured',
      severity: g.entirely ? 'fail' : 'advice',
      title: `Focused item${n === 1 ? '' : 's'} ${g.entirely ? 'hidden' : 'partly hidden'} under ${cover.a}`,
      summary: `When ${when}, ${n} item${n === 1 ? ' is' : 's are'} ${g.entirely ? 'completely' : 'partly'} covered by ${cover.a} ${describe(g.by)} at the moment ${n === 1 ? 'it receives' : 'they receive'} focus${g.entirely ? ', so keyboard users cannot see where focus is' : ''}.`,
      fix,
      note: g.entirely ? undefined : 'Partly covered passes WCAG 2.4.11 (AA) but fails 2.4.12 (AAA), which asks for the whole item to be visible.',
      wcag: g.entirely ? ['2.4.11'] : ['2.4.12'],
      elements: g.stops.map((s) => s.element),
    });
  }

  // Group trap findings: "stuck" (Tab cancelled, focus stays) vs "managed" (script cancels Tab
  // and moves focus itself, as modal dialogs and custom widgets do). One issue per group.
  const stuck = probe.trapped.filter((t) => t.forward && t.backward && !t.moved);
  const managed = probe.trapped.filter((t) => !stuck.includes(t));
  const trapNote = 'Detected by sending a simulated Tab key. Traps built other ways (for example moving focus back on blur) are not detected yet.';
  if (stuck.length) {
    const names = stuck.slice(0, 5).map((t) => `"${t.stop.label}"`).join(', ') + (stuck.length > 5 ? ', …' : '');
    add({
      rule: 'keyboard-trap',
      severity: 'fail',
      title: 'Keyboard trap',
      summary: `Page code cancels both Tab and Shift+Tab on ${names}, and focus stays put. Keyboard users get stuck unless another key lets them out.`,
      fix: 'Do not cancel the Tab key. If a widget really needs Tab (such as a code editor), provide a documented way out, for example Escape then Tab, and say so on screen.',
      note: trapNote,
      wcag: ['2.1.2'],
      elements: stuck.map((t) => t.stop.element),
    });
  }
  if (managed.length) {
    add({
      rule: 'tab-managed',
      severity: 'review',
      title: 'Page script takes over the Tab key',
      summary:
        `On ${managed.length} element${managed.length === 1 ? '' : 's'}, page code cancels the Tab key` +
        (managed.some((t) => t.moved) ? ' and moves focus itself' : '') +
        '. That is normal inside a modal dialog or a custom widget, but check that the order it creates makes sense and that users can always get out.',
      fix: 'Press Tab and Shift+Tab through these elements yourself. If focus jumps somewhere unexpected or cannot leave, fix the script; otherwise no change is needed.',
      note: trapNote,
      wcag: ['2.1.2', '2.4.3'],
      elements: managed.map((t) => t.stop.element),
    });
  }

  const jumps = new Set<number>();
  const rank = new Map(suggested.map((s, i) => [s, i]));
  const visible = order.stops.filter((s) => rank.has(s));
  for (let i = 0; i + 1 < visible.length; i++) {
    const a = visible[i];
    const b = visible[i + 1];
    if (rank.get(b)! >= rank.get(a)!) continue;
    // A headline link and its photo link to the same article: not a meaningful jump.
    const href = (e: Element) => (e instanceof HTMLAnchorElement ? e.href : null);
    if (href(a.element) && href(a.element) === href(b.element)) continue;
    if (b.index === a.index + 1) jumps.add(a.index);
    const ra = a.element.getBoundingClientRect();
    const rb = b.element.getBoundingClientRect();
    const where = rb.bottom <= ra.top + 2 ? 'higher up the page' : 'earlier on the same line';
    const cause = jumpCause(a, b);
    add({
      rule: 'order-jump',
      severity: 'review',
      title: `Tab order jumps backwards: ${clipLabel(a.label)} → ${clipLabel(b.label)}`,
      summary: `After stop ${a.index} "${a.label}", Tab goes to stop ${b.index} "${b.label}", which appears ${where}. People following along visually lose their place. ${cause.text}`,
      fix: cause.fix,
      note: 'Suggested, based on position on screen. Multi-column layouts, sidebars and carousels can trigger this when the order is actually fine.',
      wcag: ['2.4.3', '1.3.2'],
      elements: [a.element, b.element],
    });
  }

  const h1s = Array.from(document.querySelectorAll('h1, [role=heading][aria-level="1"]')).filter(
    (h) => typeof h.checkVisibility !== 'function' || h.checkVisibility(),
  );
  if (h1s.length > 1) {
    add({
      rule: 'multiple-h1',
      severity: 'advice',
      title: 'More than one H1',
      summary: `The page has ${h1s.length} top-level (H1) headings. A single H1 naming the page helps screen reader users confirm where they are.`,
      fix: 'Keep one H1 for the page title and make the others H2.',
      note: 'A best practice, not a WCAG failure.',
      wcag: ['1.3.1'],
      elements: h1s,
    });
  }

  const main = document.querySelector('main, [role=main]');
  if (main && order.stops.length) {
    const firstInMain = order.stops.findIndex((s) => contains(main, s.element));
    const hasSkip = order.stops.slice(0, 2).some((s) => isSkipLink(s.element));
    if (!hasSkip && firstInMain >= config.checks.skipLinkMinStops) {
      add({
        rule: 'no-skip-link',
        severity: 'advice',
        title: 'No skip link',
        summary: `Keyboard users press Tab ${firstInMain} times to get past the header and navigation to the main content. A "Skip to main content" link as the first stop cuts that to one press. Screen reader users can jump by landmark, but sighted keyboard users cannot.`,
        fix: 'Add <a href="#main">Skip to main content</a> as the first thing in <body>, give <main> id="main", and make the link visible when it receives focus.',
        note: 'Landmarks and headings can satisfy WCAG 2.4.1 on their own, so this is advice rather than a failure.',
        wcag: ['2.4.1'],
        elements: [order.stops[0].element],
      });
    }
  }

  return { issues, jumps };
}

function jumpCause(a: Stop, b: Stop): { text: string; fix: string } {
  const pos = [b, a].find((s) => s.tabindex > 0);
  if (pos) {
    return {
      text: `Cause: tabindex="${pos.tabindex}" on "${pos.label}".`,
      fix: `Remove tabindex="${pos.tabindex}" and place the element in the HTML where it should be reached.`,
    };
  }
  const box = reorderedContainer(b.element) ?? reorderedContainer(a.element);
  if (box) {
    return {
      text: `Likely cause: ${describe(box)} rearranges its items with CSS (order, a reversed direction or grid placement), so what you see differs from the HTML order.`,
      fix: 'Make the HTML source order match the visual order. (Chrome and Edge also support CSS reading-flow, but other browsers do not yet.)',
    };
  }
  return {
    text: 'Likely cause: the HTML order differs from the layout (for example absolute positioning or floats).',
    fix: 'Make the HTML source order match the visual order.',
  };
}

function reorderedContainer(el: Element): Element | null {
  for (let n = composedParent(el); n && n !== document.body; n = composedParent(n)) {
    const cs = getComputedStyle(n);
    const flex = cs.display.includes('flex');
    const grid = cs.display.includes('grid');
    if (!flex && !grid) continue;
    if (flex && cs.flexDirection.endsWith('reverse')) return n;
    if (grid && cs.gridAutoFlow.includes('dense')) return n;
    for (const c of Array.from(n.children)) {
      const ccs = getComputedStyle(c);
      if (ccs.order !== '0') return n;
      if (grid && (ccs.gridRowStart !== 'auto' || ccs.gridColumnStart !== 'auto')) return n;
    }
  }
  return null;
}

function clipLabel(s: string): string {
  return s.length > 24 ? `${s.slice(0, 23)}…` : s;
}

export function isSkipLink(el: Element): boolean {
  const href = el instanceof HTMLAnchorElement ? el.getAttribute('href') ?? '' : '';
  if (!/^#./.test(href)) return false;
  return !!document.getElementById(decodeURIComponent(href.slice(1)));
}

/** "a sticky header", "the fixed element", ... plus whether it stays put while the page scrolls. */
function coverDesc(el: Element): { a: string; the: string; pinned: boolean } {
  const pos = getComputedStyle(el).position;
  const pinned = pos === 'sticky' || pos === 'fixed';
  const thing = el.matches('header, [role=banner]') ? 'header' : el.matches('footer, [role=contentinfo]') ? 'footer' : 'element';
  const noun = `${pinned ? `${pos} ` : ''}${thing}`;
  return { a: `${/^[aeiou]/.test(noun) ? 'an' : 'a'} ${noun}`, the: `the ${noun}`, pinned };
}

function positionedAncestor(el: Element): Element | null {
  for (let n: Element | null = el; n; n = composedParent(n)) {
    const p = getComputedStyle(n).position;
    if (p === 'fixed' || p === 'sticky') return n;
  }
  return null;
}

export function contains(ancestor: Element, node: Element): boolean {
  for (let n: Element | null = node; n; n = composedParent(n)) if (n === ancestor) return true;
  return false;
}

function related(a: Element, b: Element): boolean {
  return contains(a, b) || contains(b, a);
}

function deepActive(): Element | null {
  let a = document.activeElement;
  while (a?.shadowRoot?.activeElement) a = a.shadowRoot.activeElement;
  return a;
}
