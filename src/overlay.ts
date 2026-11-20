/**
 * The visual layer: numbered badges, curved arrows and a small control panel.
 *
 * Isolation and safety choices:
 *  - Everything lives in a Shadow DOM under a custom <tab-order-viz> element, so page CSS
 *    selectors cannot reach in and our CSS cannot leak out. `:host { all: initial }`
 *    also blocks inherited properties (font, color) from the page.
 *  - The host is absolutely positioned at 0,0 with zero size: it takes no space in the
 *    page's layout. The badge layer is sized to the document, never larger.
 *  - Styles go in via a constructed stylesheet (adoptedStyleSheets), not a <style> tag,
 *    and DOM is built with createElement/textContent (never innerHTML). That keeps it
 *    working under strict style-src and Trusted Types policies.
 *  - Badges and arrows are aria-hidden and pointer-events: none. Only the panel is
 *    interactive, and it is appended at the very end of the document so it can only add
 *    stops after the page's own last stop, never shift the page's numbering.
 */
import type { OrderResult } from './order';
import { OVERLAY_TAG } from './order';

const SVG_NS = 'http://www.w3.org/2000/svg';
const BADGE_RADIUS = 11;

const STYLE = `
:host { all: initial; }
.layer { position: absolute; top: 0; left: 0; pointer-events: none; }
.layer[hidden] { display: none; }
svg { position: absolute; top: 0; left: 0; overflow: visible; }
.halo { fill: none; stroke: #ffffff; stroke-width: 5; stroke-linecap: round; }
.path { fill: none; stroke: #1a1a5e; stroke-width: 2; stroke-linecap: round; }
.head { fill: #1a1a5e; }
.badge {
  position: absolute; transform: translate(-50%, -50%);
  min-width: 22px; height: 22px; padding: 0 5px; box-sizing: border-box;
  border-radius: 11px; border: 2px solid #ffffff; box-shadow: 0 0 0 1px #1a1a5e;
  background: #1a1a5e; color: #ffffff; white-space: nowrap;
  font: 700 12px/18px system-ui, -apple-system, "Segoe UI", sans-serif; text-align: center;
}
.badge.hidden-stop { background: #ffffff; color: #1a1a5e; border: 2px dashed #1a1a5e; }
.panel {
  position: fixed; right: 12px; bottom: 12px; max-width: 300px; pointer-events: auto;
  background: #ffffff; color: #111111; border: 2px solid #1a1a5e; border-radius: 6px;
  padding: 10px 12px; box-shadow: 0 2px 10px rgba(0,0,0,.25);
  font: 14px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif;
}
.panel p { margin: 0 0 6px; }
.title { font-weight: 700; }
.legend { font-size: 12px; color: #333333; }
.sample { display: inline-block; min-width: 18px; height: 18px; border-radius: 9px; font: 700 11px/14px system-ui, sans-serif;
  text-align: center; box-sizing: border-box; background: #1a1a5e; color: #fff; border: 2px solid #1a1a5e; vertical-align: middle; }
.sample.hidden-stop { background: #fff; color: #1a1a5e; border-style: dashed; }
.buttons { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px; }
button {
  font: inherit; font-size: 13px; padding: 4px 10px; border-radius: 4px; cursor: pointer;
  border: 1px solid #1a1a5e; background: #ffffff; color: #1a1a5e;
}
button:hover { background: #eef0ff; }
button:focus-visible { outline: 3px solid #1a1a5e; outline-offset: 2px; }
`;

export class Overlay {
  private host: HTMLElement;
  private layer: HTMLDivElement;
  private svg: SVGSVGElement;
  private status: HTMLParagraphElement;
  private toggleButton: HTMLButtonElement;
  private result: OrderResult;
  private badges: HTMLDivElement[] = [];
  private frame = 0;
  private resizeObserver: ResizeObserver;
  private readonly schedule = () => {
    if (!this.frame) this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.layout();
    });
  };

  constructor(private compute: () => OrderResult, private onClose: () => void) {
    this.result = compute();

    this.host = document.createElement(OVERLAY_TAG);
    const hs = this.host.style;
    for (const [k, v] of Object.entries({
      position: 'absolute', top: '0', left: '0', width: '0', height: '0', margin: '0', padding: '0',
      border: '0', overflow: 'visible', display: 'block', 'z-index': '2147483647',
    })) hs.setProperty(k, v, 'important');

    const root = this.host.attachShadow({ mode: 'open' });
    applyStyles(root);

    this.layer = el('div', 'layer');
    this.layer.setAttribute('aria-hidden', 'true');
    this.svg = document.createElementNS(SVG_NS, 'svg');
    this.svg.append(arrowheadDefs());
    this.layer.append(this.svg);

    const panel = el('div', 'panel');
    panel.setAttribute('role', 'region');
    panel.setAttribute('aria-label', 'Tab order visualizer');
    const title = el('p', 'title');
    title.textContent = 'Tab order';
    this.status = el('p', 'status');
    this.status.setAttribute('role', 'status');
    const legend = el('p', 'legend');
    legend.append(sample('1', false), ' real Tab order   ', sample('2', true), ' focusable but not visible');
    const buttons = el('div', 'buttons');
    this.toggleButton = button('Hide overlay', () => this.setVisible(this.layer.hidden !== false));
    buttons.append(
      this.toggleButton,
      button('Refresh', () => this.refresh()),
      button('Close', () => this.destroy()),
    );
    panel.append(title, this.status, legend, buttons);

    root.append(this.layer, panel);
    document.documentElement.append(this.host);

    this.render();
    window.addEventListener('scroll', this.schedule, { passive: true, capture: true });
    window.addEventListener('resize', this.schedule, { passive: true });
    this.resizeObserver = new ResizeObserver(this.schedule);
    this.resizeObserver.observe(document.body);
  }

  setVisible(visible: boolean): void {
    this.layer.hidden = !visible;
    this.toggleButton.textContent = visible ? 'Hide overlay' : 'Show overlay';
    if (visible) this.layout();
  }

  refresh(): void {
    this.result = this.compute();
    this.render();
  }

  destroy(): void {
    window.removeEventListener('scroll', this.schedule, { capture: true });
    window.removeEventListener('resize', this.schedule);
    this.resizeObserver.disconnect();
    cancelAnimationFrame(this.frame);
    this.host.remove();
    this.onClose();
  }

  private render(): void {
    for (const b of this.badges) b.remove();
    this.badges = this.result.stops.map((s) => {
      const b = el('div', s.hidden ? 'badge hidden-stop' : 'badge');
      b.textContent = String(s.index);
      this.layer.append(b);
      return b;
    });
    const { stops } = this.result;
    const hiddenCount = stops.filter((s) => s.hidden).length;
    this.status.textContent =
      `${stops.length} Tab stop${stops.length === 1 ? '' : 's'}` +
      (hiddenCount ? `, ${hiddenCount} focusable but not visible` : '') + '.';
    this.layout();
  }

  /** Positions badges and redraws arrows from current element boxes. */
  private layout(): void {
    if (this.layer.hidden) return;
    const docW = document.documentElement.scrollWidth;
    const docH = document.documentElement.scrollHeight;
    this.layer.style.width = `${docW}px`;
    this.layer.style.height = `${docH}px`;
    this.svg.setAttribute('width', String(docW));
    this.svg.setAttribute('height', String(docH));

    const clampX = (x: number) => Math.min(Math.max(x, BADGE_RADIUS + 3), docW - BADGE_RADIUS - 3);
    const clampY = (y: number) => Math.min(Math.max(y, BADGE_RADIUS + 3), docH - BADGE_RADIUS - 3);
    const points = this.result.stops.map((s) => {
      const r = s.element.getBoundingClientRect();
      return [clampX(r.left + window.scrollX), clampY(r.top + window.scrollY)] as const;
    });
    points.forEach(([x, y], i) => {
      this.badges[i].style.left = `${x}px`;
      this.badges[i].style.top = `${y}px`;
    });

    while (this.svg.childNodes.length > 1) this.svg.lastChild!.remove();
    for (let i = 0; i + 1 < points.length; i++) {
      const d = curve(points[i], points[i + 1]);
      if (!d) continue;
      const halo = document.createElementNS(SVG_NS, 'path');
      halo.setAttribute('class', 'halo');
      halo.setAttribute('d', d);
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('class', 'path');
      path.setAttribute('d', d);
      path.setAttribute('marker-end', 'url(#tov-head)');
      this.svg.append(halo, path);
    }
  }
}

/** A gentle quadratic curve from badge a to badge b, trimmed so it starts/ends at badge edges. */
function curve(a: readonly [number, number], b: readonly [number, number]): string | null {
  const [x1, y1] = a;
  const [x2, y2] = b;
  const dist = Math.hypot(x2 - x1, y2 - y1);
  if (dist < BADGE_RADIUS * 2 + 4) return null;
  const bend = Math.min(80, dist * 0.2);
  const cx = (x1 + x2) / 2 + (-(y2 - y1) / dist) * bend;
  const cy = (y1 + y2) / 2 + ((x2 - x1) / dist) * bend;
  const trim = (px: number, py: number, by: number) => {
    const len = Math.hypot(cx - px, cy - py) || 1;
    return [px + ((cx - px) / len) * by, py + ((cy - py) / len) * by];
  };
  const [sx, sy] = trim(x1, y1, BADGE_RADIUS + 1);
  const [ex, ey] = trim(x2, y2, BADGE_RADIUS + 3);
  const f = (n: number) => n.toFixed(1);
  return `M${f(sx)} ${f(sy)} Q${f(cx)} ${f(cy)} ${f(ex)} ${f(ey)}`;
}

function arrowheadDefs(): SVGDefsElement {
  const defs = document.createElementNS(SVG_NS, 'defs');
  const marker = document.createElementNS(SVG_NS, 'marker');
  for (const [k, v] of Object.entries({
    id: 'tov-head', viewBox: '0 0 10 10', refX: '8', refY: '5',
    markerWidth: '7', markerHeight: '7', orient: 'auto-start-reverse',
  })) marker.setAttribute(k, v);
  const tip = document.createElementNS(SVG_NS, 'path');
  tip.setAttribute('d', 'M0 0 L10 5 L0 10 z');
  tip.setAttribute('class', 'head');
  marker.append(tip);
  defs.append(marker);
  return defs;
}

function applyStyles(root: ShadowRoot): void {
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(STYLE);
    root.adoptedStyleSheets = [sheet];
  } catch {
    const style = document.createElement('style');
    style.textContent = STYLE;
    root.append(style);
  }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = className;
  return e;
}

function button(text: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = text;
  b.addEventListener('click', onClick);
  return b;
}

function sample(text: string, hidden: boolean): HTMLSpanElement {
  const s = el('span', hidden ? 'sample hidden-stop' : 'sample');
  s.textContent = text;
  return s;
}
