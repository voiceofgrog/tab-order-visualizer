/**
 * Suggested order: a heuristic for visual reading order.
 *
 *  1. Group stops by their outermost landmark (header, nav, main, aside, footer, ...).
 *     Stops outside any landmark form one "page" group.
 *  2. Order groups by where they start on screen: top first, then left (right in RTL).
 *  3. Inside a group, cluster stops into rows (an element joins a row if its vertical
 *     centre falls inside that row's band), rows top to bottom, each row left to right.
 *
 * Measured with the page scrolled to the top, so sticky headers sit where they start.
 * Focusable-but-invisible stops have no meaningful position and are left out.
 * Multi-column articles, carousels and overlapping layouts can fool this. It is a
 * suggestion, not a verdict.
 */
import config from '../config/defaults.json';
import { composedParent, type Stop } from './order';

const LANDMARK =
  'header,footer,nav,main,aside,[role=banner],[role=navigation],[role=main],[role=complementary],' +
  '[role=contentinfo],[role=search],[role=region],section[aria-label],section[aria-labelledby]';

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function suggestOrder(stops: Stop[]): Stop[] {
  const sx = window.scrollX;
  const sy = window.scrollY;
  window.scrollTo(sx, 0);
  try {
    return arrange(stops.filter((s) => !s.hidden));
  } finally {
    window.scrollTo(sx, sy);
  }
}

function arrange(stops: Stop[]): Stop[] {
  const rtl = getComputedStyle(document.documentElement).direction === 'rtl';
  const tol = config.checks.groupTolerancePx;
  const box = new Map<Stop, Box>();
  for (const s of stops) {
    const r = s.element.getBoundingClientRect();
    box.set(s, { left: r.left + window.scrollX, top: r.top + window.scrollY, right: r.right + window.scrollX, bottom: r.bottom + window.scrollY });
  }

  const groups = new Map<Element | null, Stop[]>();
  for (const s of stops) {
    const key = outermostLandmark(s.element);
    const list = groups.get(key) ?? [];
    list.push(s);
    groups.set(key, list);
  }

  const groupBox = (list: Stop[]) => {
    const bs = list.map((s) => box.get(s)!);
    return { top: Math.min(...bs.map((b) => b.top)), left: Math.min(...bs.map((b) => b.left)), right: Math.max(...bs.map((b) => b.right)) };
  };
  const ordered = [...groups.values()].map((list) => ({ list, b: groupBox(list) }));
  ordered.sort((a, b) =>
    Math.abs(a.b.top - b.b.top) > tol ? a.b.top - b.b.top : rtl ? b.b.right - a.b.right : a.b.left - b.b.left,
  );

  const out: Stop[] = [];
  for (const { list } of ordered) out.push(...rowsOf(list, box, rtl));
  return out;
}

function rowsOf(list: Stop[], box: Map<Stop, Box>, rtl: boolean): Stop[] {
  const items = [...list].sort((a, b) => box.get(a)!.top - box.get(b)!.top);
  const rows: { top: number; bottom: number; items: Stop[] }[] = [];
  for (const s of items) {
    const b = box.get(s)!;
    const centre = (b.top + b.bottom) / 2;
    const row = rows.find((r) => centre >= r.top && centre <= r.bottom);
    if (row) {
      row.items.push(s);
      row.top = Math.min(row.top, b.top);
      row.bottom = Math.max(row.bottom, b.bottom);
    } else {
      rows.push({ top: b.top, bottom: b.bottom, items: [s] });
    }
  }
  rows.sort((a, b) => a.top - b.top);
  return rows.flatMap((r) =>
    r.items.sort((a, b) => (rtl ? box.get(b)!.right - box.get(a)!.right : box.get(a)!.left - box.get(b)!.left)),
  );
}

function outermostLandmark(el: Element): Element | null {
  let found: Element | null = null;
  for (let n: Element | null = el; n; n = composedParent(n)) {
    if (n.matches(LANDMARK)) found = n;
  }
  return found;
}
