/**
 * The visual layer: badges, arrows, outlines and the control panel.
 *
 * Isolation and safety choices:
 *  - Everything lives in a Shadow DOM under a custom <tab-order-viz> element, so page CSS
 *    selectors cannot reach in and our CSS cannot leak out. `:host { all: initial }`
 *    also blocks inherited properties (font, color) from the page.
 *  - The host is absolutely positioned at 0,0 with zero size: it takes no space in the
 *    page's layout. The drawing layer is sized to the document, never larger.
 *  - Styles go in via a constructed stylesheet, and DOM is built with createElement /
 *    textContent (never innerHTML), so it works under strict style-src and Trusted Types.
 *  - Badges and arrows are aria-hidden and pointer-events: none. Only the panel is
 *    interactive, appended at the end of the document so it can only add Tab stops after
 *    the page's own last stop, never shift the page's numbering.
 *
 * Meaning never depends on colour alone: real order = round badges + solid arrows;
 * suggested order = square badges + dashed arrows; backward jumps = thicker arrow + "back"
 * label; invisible stops = dashed outline.
 */
import config from '../config/defaults.json';
import wcag from '../config/wcag.json';
import { OVERLAY_TAG, type Stop } from './order';
import { contains } from './checks';
import { estimate, formatSeconds, PROFILES, skipLinkEstimate } from './time';
import type { Issue, ScanResult, Severity } from './types';
import { VERSION } from './version';
import type { Region } from './regions';
import { REGION_CSS, buildRegionUi, drawOverview, drawRegion, makeRegionLabels, regionRect, renderRegionList, type Kit, type RegionUi } from './overlay-regions';

interface Palette { label: string; real: string; realText: string; suggested: string; suggestedText: string; halo: string }
interface Size { label: string; badge: number; font: number; stroke: number }
type View = 'real' | 'suggested' | 'both';
type Pt = readonly [number, number];

const PALETTES = config.display.palettes as Record<string, Palette>;
const SIZES = config.display.sizes as Record<string, Size>;
const WCAG = wcag as unknown as Record<string, { name: string; level: string; slug: string }>;
const SEVERITY_LABEL: Record<Severity, string> = { fail: 'Fail', review: 'Review', advice: 'Advice' };
const SVG_NS = 'http://www.w3.org/2000/svg';
const MAX_SHOW_BUTTONS = 8;
const SHORTCUT = parseShortcut(config.keyboard.focusPanelShortcut);
const SHORTCUT_LABEL = config.keyboard.focusPanelShortcut;

interface Shortcut { alt: boolean; shift: boolean; ctrl: boolean; meta: boolean; code: string }

/** "Alt+Shift+T" -> modifiers plus a physical key code, so it also works on Mac (Option changes e.key). */
function parseShortcut(text: string): Shortcut {
  const parts = text.split('+').map((p) => p.trim().toLowerCase());
  const key = parts[parts.length - 1];
  const code = /^[a-z]$/.test(key) ? `Key${key.toUpperCase()}` : /^\d$/.test(key) ? `Digit${key}` : key;
  return { alt: parts.includes('alt'), shift: parts.includes('shift'), ctrl: parts.includes('ctrl'), meta: parts.includes('meta'), code };
}

function matchesShortcut(e: KeyboardEvent, s: Shortcut): boolean {
  return e.code === s.code && e.altKey === s.alt && e.shiftKey === s.shift && e.ctrlKey === s.ctrl && e.metaKey === s.meta;
}

function deepActive(): Element | null {
  let a = document.activeElement;
  while (a?.shadowRoot?.activeElement) a = a.shadowRoot.activeElement;
  return a;
}

const STYLE = `
:host { all: initial; }
.wrap {
  --ui-bg: #ffffff; --ui-head: #f6f7fb; --ui-fg: #1d2030; --ui-muted: #555b6e; --ui-border: #e2e4ec;
  --ui-accent: #3730a3; --ui-accent-fg: #ffffff; --ui-soft: #eef0ff;
  --ui-shadow: 0 10px 30px rgba(20, 24, 50, .18), 0 2px 6px rgba(20, 24, 50, .12);
  --fail-bg: #fde8e8; --fail-fg: #8a1010; --review-bg: #fff3d1; --review-fg: #6b4a00;
  --advice-bg: #e6efff; --advice-fg: #1a3d8a; --ok-bg: #e3f6ea; --ok-fg: #14532d;
}
@media (prefers-color-scheme: dark) {
  .wrap {
    --ui-bg: #1b1d27; --ui-head: #222532; --ui-fg: #eceef6; --ui-muted: #a9aec2; --ui-border: #343849;
    --ui-accent: #a5b4fc; --ui-accent-fg: #14162a; --ui-soft: #2a2e45; --ui-shadow: 0 10px 30px rgba(0, 0, 0, .5);
    --fail-bg: #3b1717; --fail-fg: #fca5a5; --review-bg: #3a2e0c; --review-fg: #fcd34d;
    --advice-bg: #172447; --advice-fg: #93c5fd; --ok-bg: #12301f; --ok-fg: #86efac;
  }
}
.layer { position: absolute; top: 0; left: 0; pointer-events: none; }
.layer[hidden], .box[hidden], .body[hidden] { display: none; }
svg { position: absolute; top: 0; left: 0; overflow: visible; }
.dim { fill: rgba(12, 14, 32, .42); }
.shadow { fill: none; stroke: rgba(12, 14, 40, .28); stroke-width: var(--shadow-w); stroke-linecap: round; }
.halo { fill: none; stroke: var(--halo); stroke-width: var(--halo-w); stroke-linecap: round; }
.real { fill: none; stroke: var(--real); stroke-width: var(--stroke); stroke-linecap: round; }
.real.jump { stroke-width: var(--stroke-jump); }
.sugg { fill: none; stroke: var(--sugg); stroke-width: var(--stroke); stroke-dasharray: 7 5; stroke-linecap: round; }
.outline { fill: none; stroke: var(--real); stroke-width: 1.5px; }
.outline.hidden-stop { stroke-dasharray: 3 3; }
.outline-halo { fill: none; stroke: var(--halo); stroke-width: 4px; }
.hl { fill: none; stroke: var(--real); stroke-width: 4px; }
.hl-halo { fill: none; stroke: var(--halo); stroke-width: 9px; }
.head-real { fill: var(--real); }
.head-sugg { fill: var(--sugg); }
.pill { fill: var(--halo); stroke: var(--real); stroke-width: 1.5px; }
.badge.grouped { padding: 0 6px; }
.pill-text { font: 700 10.5px system-ui, -apple-system, "Segoe UI", sans-serif; fill: var(--real); }
.badge, .sbadge {
  position: absolute; transform: translate(-50%, -50%); box-sizing: border-box;
  min-width: var(--badge); height: var(--badge); padding: 0 4px; white-space: nowrap; text-align: center;
  font: 700 var(--font)/calc(var(--badge) - 4px) system-ui, -apple-system, "Segoe UI", sans-serif;
  font-variant-numeric: tabular-nums; border: 2px solid var(--halo);
}
.badge { border-radius: calc(var(--badge) / 2); background: var(--real); color: var(--real-text);
  box-shadow: 0 0 0 1px var(--real), 0 1px 2px rgba(0,0,0,.3), 0 3px 8px rgba(0,0,0,.18); }
.badge.hidden-stop { background: var(--halo); color: var(--real); border: 2px dashed var(--real); }
.sbadge { border-radius: 4px; background: var(--sugg); color: var(--sugg-text);
  box-shadow: 0 0 0 1px var(--sugg), 0 1px 2px rgba(0,0,0,.3), 0 3px 8px rgba(0,0,0,.18); }

.panel {
  position: fixed; right: 16px; bottom: 16px; width: 360px; max-height: calc(100vh - 32px); overflow: auto;
  box-sizing: border-box; pointer-events: auto; background: var(--ui-bg); color: var(--ui-fg);
  border: 1px solid var(--ui-border); border-radius: 12px; box-shadow: var(--ui-shadow);
  font: 13.5px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; text-align: left;
}
.panel.left { right: auto; left: 16px; }
.panel.min { width: auto; }
.panel:focus { outline: none; }
.panel:focus-visible { outline: 3px solid var(--ui-accent); outline-offset: 2px; }
.header { position: sticky; top: 0; z-index: 1; display: flex; align-items: center; gap: 8px;
  padding: 7px 8px 7px 14px; background: var(--ui-head); border-bottom: 1px solid var(--ui-border); border-radius: 12px 12px 0 0; }
.panel.min .header { border-bottom: 0; border-radius: 12px; }
.brand { display: flex; align-items: center; gap: 8px; font-weight: 700; font-size: 14px; flex: 1; white-space: nowrap; }
.mark { display: inline-block; width: 18px; height: 18px; border-radius: 9px; background: #1a1a5e; color: #fff;
  font: 700 11px/18px system-ui, sans-serif; text-align: center; box-shadow: 0 0 0 2px #fff, 0 0 0 3px #1a1a5e; }
.icons { display: flex; gap: 2px; }
.icon { display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px; padding: 0;
  border: 0; border-radius: 8px; background: transparent; color: var(--ui-muted); cursor: pointer; }
.icon:hover { background: var(--ui-soft); color: var(--ui-fg); }
.icon svg { position: static; width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.7;
  stroke-linecap: round; stroke-linejoin: round; }
.body { padding: 10px 14px 12px; }
.panel p { margin: 0 0 8px; }
.panel a { color: var(--ui-accent); }
.status { font-weight: 600; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 0 0 8px; }
.chip { display: inline-flex; align-items: center; padding: 2px 9px; border-radius: 999px; font-size: 12px; font-weight: 600; }
.chip.fail, .sev.fail { background: var(--fail-bg); color: var(--fail-fg); }
.chip.review, .sev.review { background: var(--review-bg); color: var(--review-fg); }
.chip.advice, .sev.advice { background: var(--advice-bg); color: var(--advice-fg); }
.chip.ok { background: var(--ok-bg); color: var(--ok-fg); }
.small { font-size: 12px; color: var(--ui-muted); }
.sect { border: 0; border-top: 1px solid var(--ui-border); padding: 0; margin: 0; }
.sect > summary { list-style: none; display: flex; align-items: center; justify-content: space-between; padding: 10px 0;
  font-size: 11.5px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--ui-muted); cursor: pointer; }
.sect > summary::-webkit-details-marker { display: none; }
.sect > summary::after { content: "+"; font-size: 16px; font-weight: 500; line-height: 1; }
.sect[open] > summary::after { content: "\\2212"; }
.sect > .content { padding: 0 0 10px; }
fieldset { border: 0; margin: 0 0 8px; padding: 0; }
legend { padding: 0; margin-bottom: 4px; font-size: 12px; color: var(--ui-muted); }
.seg { display: flex; padding: 3px; gap: 3px; background: var(--ui-head); border: 1px solid var(--ui-border); border-radius: 9px; }
.seg label { flex: 1; display: flex; align-items: center; justify-content: center; gap: 5px; padding: 5px 6px;
  border-radius: 7px; font-size: 12.5px; white-space: nowrap; }
.seg label:has(input:checked) { background: var(--ui-bg); box-shadow: 0 1px 3px rgba(0,0,0,.15); font-weight: 600; }
.row { display: flex; flex-wrap: wrap; gap: 6px 14px; align-items: center; margin-bottom: 8px; }
label { cursor: pointer; }
input[type=checkbox], input[type=radio] { accent-color: var(--ui-accent); margin: 0; }
.row > label { display: inline-flex; align-items: center; gap: 6px; max-width: 100%; min-width: 0; }
.row > label.grow { flex: 1; }
.row > label.grow select { flex: 1; width: 100%; min-width: 0; }
select { font: inherit; font-size: 13px; max-width: 100%; padding: 4px 6px; border: 1px solid var(--ui-border);
  border-radius: 7px; background: var(--ui-bg); color: var(--ui-fg); }
.key { display: flex; flex-wrap: wrap; gap: 4px 12px; align-items: center; }
.sample { display: inline-block; min-width: 18px; height: 18px; box-sizing: border-box; padding: 0 3px; vertical-align: middle;
  margin-right: 4px; font: 700 11px/14px system-ui, sans-serif; text-align: center; border: 2px solid #1a1a5e; }
.sample.real { border-radius: 9px; background: #1a1a5e; color: #fff; }
.sample.hidden-stop { border-radius: 9px; background: #fff; color: #1a1a5e; border-style: dashed; }
.sample.sugg { border-radius: 4px; background: #b0006a; border-color: #b0006a; color: #fff; }
.buttons { display: flex; gap: 6px; flex-wrap: wrap; margin: 6px 0 8px; }
button { font: inherit; font-size: 12.5px; font-weight: 600; padding: 5px 11px; border-radius: 8px; cursor: pointer;
  border: 1px solid var(--ui-border); background: var(--ui-bg); color: var(--ui-fg); }
button:hover { background: var(--ui-soft); }
button:focus-visible, input:focus-visible, select:focus-visible, summary:focus-visible, a:focus-visible {
  outline: 3px solid var(--ui-accent); outline-offset: 2px;
}
ul { list-style: none; margin: 0; padding: 0; }
li { margin: 0 0 6px; }
.issue { border: 1px solid var(--ui-border); border-radius: 9px; padding: 0 10px; }
.issue[open] { padding-bottom: 6px; }
.issue > summary { padding: 7px 0; cursor: pointer; font-weight: 600; }
.sev { display: inline-block; min-width: 50px; margin-right: 6px; padding: 1px 6px; border-radius: 999px;
  font-size: 10.5px; font-weight: 700; text-align: center; text-transform: uppercase; letter-spacing: .04em; }
table { border-collapse: collapse; width: 100%; margin: 4px 0 8px; font-size: 12.5px; font-variant-numeric: tabular-nums; }
th, td { text-align: left; padding: 5px 4px; border-bottom: 1px solid var(--ui-border); vertical-align: top; }
thead th { font-size: 11.5px; font-weight: 600; color: var(--ui-muted); }
tbody th { font-weight: 600; }
.basis { padding-left: 16px; list-style: disc; }
.basis li { margin-bottom: 4px; }
.foot { margin: 4px 0 0; padding-top: 10px; border-top: 1px solid var(--ui-border); }
@media (forced-colors: active) {
  .layer { forced-color-adjust: none; }
  .shadow { display: none; }
  .panel { border-color: CanvasText; }
}
@media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }
`;

export class Overlay {
  #host: HTMLElement;
  #wrap: HTMLDivElement;
  #layer: HTMLDivElement;
  #svg: SVGSVGElement;
  #realBox: HTMLDivElement;
  #suggBox: HTMLDivElement;
  #panel!: HTMLDivElement;
  #status!: HTMLParagraphElement;
  #stepOut!: HTMLParagraphElement;
  #notesBox!: HTMLDivElement;
  #issuesTitle!: HTMLElement;
  #issuesNote!: HTMLParagraphElement;
  #issuesList!: HTMLUListElement;
  #toggleButton!: HTMLButtonElement;
  #targetSelect!: HTMLSelectElement;
  #pickButton!: HTMLButtonElement;
  #pickHint!: HTMLParagraphElement;
  #timeBody!: HTMLTableSectionElement;
  #timeNotes!: HTMLDivElement;
  #basisList!: HTMLUListElement;
  #picking = false;
  #returnTo: Element | null = null;
  #body!: HTMLDivElement;
  #chips!: HTMLDivElement;
  #minButton!: HTMLButtonElement;

  #result: ScanResult | null = null;
  #realBadges: HTMLDivElement[] = [];
  #suggBadges: HTMLDivElement[] = [];
  #view: View = 'real';
  /** Regions (boxes per landmark) or every stop. Chosen automatically on first render. */
  #detail: 'regions' | 'stops' = 'stops';
  #detailChosen = false;
  #regionUi: RegionUi | null = null;
  #expanded: Region | null = null;
  #longOnly = false;
  #regionBox!: HTMLDivElement;
  #regionLabels: HTMLDivElement[] = [];
  #arrows = true;
  #outlines = true;
  #dim = false;
  #palette = config.display.defaultPalette;
  #size = config.display.defaultSize;
  #step = -1;
  #highlight: Element[] = [];
  #generation = 0;
  #frame = 0;
  #resizeObserver: ResizeObserver;
  readonly #schedule = () => {
    if (!this.#frame) this.#frame = requestAnimationFrame(() => {
      this.#frame = 0;
      this.#layout();
    });
  };

  constructor(private runScan: () => Promise<ScanResult>, private onClose: () => void) {
    this.#host = document.createElement(OVERLAY_TAG);
    for (const [k, v] of Object.entries({
      position: 'absolute', top: '0', left: '0', width: '0', height: '0', margin: '0', padding: '0',
      border: '0', overflow: 'visible', display: 'block', 'z-index': '2147483647',
    })) this.#host.style.setProperty(k, v, 'important');

    const root = this.#host.attachShadow({ mode: 'open' });
    applyStyles(root);
    this.#wrap = el('div', 'wrap');
    this.#layer = el('div', 'layer');
    this.#layer.setAttribute('aria-hidden', 'true');
    this.#svg = document.createElementNS(SVG_NS, 'svg');
    this.#realBox = el('div', 'box');
    this.#suggBox = el('div', 'box');
    this.#regionBox = el('div', 'box');
    this.#layer.append(this.#svg, this.#suggBox, this.#realBox, this.#regionBox);
    this.#wrap.append(this.#layer, this.#buildPanel());
    root.append(this.#wrap);
    document.documentElement.append(this.#host);

    this.#applyDisplay();
    window.addEventListener('scroll', this.#schedule, { passive: true, capture: true });
    window.addEventListener('resize', this.#schedule, { passive: true });
    this.#resizeObserver = new ResizeObserver(this.#schedule);
    this.#resizeObserver.observe(document.body);
    document.addEventListener('keydown', this.#onShortcut, true);
    // Keyboard users land in the panel straight away (they just invoked the tool).
    void this.refresh().then(() => this.focusPanel());
  }

  /** Moves focus into the panel, remembering where it was on the page. */
  focusPanel(): void {
    if (!this.#host.isConnected) return;
    // While focus is anywhere in our Shadow DOM, the document reports the host as active
    // (Node.contains does not look inside shadow roots, so it cannot answer this).
    if (!this.#focusInside()) this.#returnTo = deepActive();
    this.#panel.focus({ preventScroll: true });
  }

  #focusInside(): boolean {
    return document.activeElement === this.#host;
  }

  /** Sends focus back to where it was on the page before the panel took it. */
  #returnFocus(): void {
    const target = this.#returnTo as HTMLElement | null;
    this.#returnTo = null;
    if (target?.isConnected && typeof target.focus === 'function') target.focus({ preventScroll: true });
    else (document.activeElement as HTMLElement | null)?.blur?.();
  }

  readonly #onShortcut = (e: KeyboardEvent) => {
    if (!matchesShortcut(e, SHORTCUT)) return;
    e.preventDefault();
    e.stopPropagation();
    if (this.#focusInside()) this.#returnFocus();
    else this.focusPanel();
  };

  setVisible(visible: boolean): void {
    this.#layer.hidden = !visible;
    const label = visible ? 'Hide overlay' : 'Show overlay';
    this.#toggleButton.setAttribute('aria-label', label);
    this.#toggleButton.title = label;
    this.#toggleButton.replaceChildren(icon(visible ? ICONS.eye : ICONS.eyeOff));
    if (visible) this.#layout();
  }

  async refresh(): Promise<void> {
    const gen = ++this.#generation;
    this.#status.textContent = 'Scanning…';
    try {
      const r = await this.runScan();
      if (gen !== this.#generation || !this.#host.isConnected) return;
      this.#result = r;
      this.#step = -1;
      this.#highlight = [];
      this.#render();
    } catch (e) {
      this.#status.textContent = `Scan failed: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  destroy(): void {
    this.#generation++;
    if (this.#picking) this.#stopPicking('');
    window.removeEventListener('scroll', this.#schedule, { capture: true });
    window.removeEventListener('resize', this.#schedule);
    document.removeEventListener('keydown', this.#onShortcut, true);
    const hadFocus = this.#focusInside();
    this.#resizeObserver.disconnect();
    cancelAnimationFrame(this.#frame);
    this.#host.remove();
    if (hadFocus) this.#returnFocus(); // closing from the panel: do not strand keyboard focus
    this.onClose();
  }

  // ---------------------------------------------------------------- panel

  #buildPanel(): HTMLDivElement {
    const panel = (this.#panel = el('div', 'panel'));
    panel.setAttribute('role', 'region');
    panel.setAttribute('aria-label', 'Tab order visualizer');
    panel.tabIndex = -1; // focusable by script (on open, shortcut), not an extra Tab stop
    panel.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.#picking) {
        e.preventDefault();
        this.#returnFocus();
      }
    });

    // Header bar: name plus icon buttons (each has an accessible name and a tooltip).
    const header = el('div', 'header');
    const brand = el('div', 'brand');
    const mark = el('span', 'mark');
    mark.setAttribute('aria-hidden', 'true');
    mark.textContent = '1';
    brand.append(mark, 'Tab order');
    const icons = el('div', 'icons');
    this.#toggleButton = iconButton('Hide overlay', ICONS.eye, () => this.setVisible(this.#layer.hidden !== false));
    this.#minButton = iconButton('Minimise panel', ICONS.minus, () => this.#setMinimised(!this.#body.hidden));
    icons.append(
      this.#toggleButton,
      iconButton('Refresh', ICONS.refresh, () => void this.refresh()),
      iconButton('Move panel', ICONS.move, () => panel.classList.toggle('left')),
      this.#minButton,
      iconButton('Close', ICONS.close, () => this.destroy()),
    );
    header.append(brand, icons);

    this.#body = el('div', 'body');
    this.#status = el('p', 'status');
    this.#status.setAttribute('role', 'status');
    this.#chips = el('div', 'chips');
    this.#notesBox = el('div', 'small');
    const keys = el('p', 'small');
    keys.textContent = `${SHORTCUT_LABEL}: move between the page and this panel. Escape: back to the page.`;

    const viewSet = el('fieldset', '');
    const legend = el('legend', '');
    legend.textContent = 'Show';
    const viewRow = el('div', 'seg');
    for (const [value, text] of [['real', 'Real order'], ['suggested', 'Suggested order'], ['both', 'Both']] as const) {
      viewRow.append(radio('tov-view', value, text, value === this.#view, () => {
        this.#view = value;
        this.#step = -1;
        this.#highlight = [];
        this.#stepOut.textContent = '';
        this.#layout();
      }));
    }
    viewSet.append(legend, viewRow);

    if (!__LITE__) {
      this.#regionUi = buildRegionUi(KIT, this.#detail, (v) => {
        this.#detail = v;
        this.#detailChosen = true;
        this.#expanded = null;
        this.#renderRegionList();
        this.#layout();
      }, () => this.#expand(null));
    }

    const toggles = el('div', 'row');
    toggles.append(
      checkbox('Arrows', this.#arrows, (v) => { this.#arrows = v; this.#layout(); }),
      checkbox('Outlines', this.#outlines, (v) => { this.#outlines = v; this.#layout(); }),
      checkbox('Dim page', this.#dim, (v) => { this.#dim = v; this.#layout(); }),
      checkbox('Long jumps only', this.#longOnly, (v) => { this.#longOnly = v; this.#layout(); }),
    );

    const selects = el('div', 'row');
    selects.append(
      select('Colours', Object.entries(PALETTES).map(([k, p]) => [k, p.label]), this.#palette, (v) => { this.#palette = v; this.#applyDisplay(); }),
      select('Size', Object.entries(SIZES).map(([k, s]) => [k, s.label]), this.#size, (v) => { this.#size = v; this.#applyDisplay(); }),
    );

    const key = el('p', 'small key');
    key.append(keyItem(sample('1', 'real'), 'real order (solid)'), keyItem(sample('1', 'sugg'), 'suggested (dashed)'),
      keyItem(sample('2', 'hidden-stop'), 'focusable, not visible'));

    const stepButtons = el('div', 'buttons');
    stepButtons.append(button('Previous stop', () => this.#stepBy(-1)), button('Next stop', () => this.#stepBy(1)));
    this.#stepOut = el('p', 'small');
    this.#stepOut.setAttribute('aria-live', 'polite');

    const [issues, issuesSummary] = section('Issues');
    this.#issuesTitle = issuesSummary;
    this.#issuesNote = el('p', 'small');
    this.#issuesList = el('ul', '');
    issues.lastElementChild!.append(this.#issuesNote, this.#issuesList);

    const [display] = section('Display');
    display.lastElementChild!.append(...(this.#regionUi ? [this.#regionUi.detailSet] : []), viewSet, toggles, selects, key);

    const [step] = section('Step through');
    step.lastElementChild!.append(stepButtons, this.#stepOut);
    const [time] = section('Time to reach (estimate)');
    this.#buildTimeSection(time.lastElementChild as HTMLElement);

    // Installed bookmarklets never update themselves, so say which version this is and where to
    // get a newer one. A plain link the user chooses to follow: the tool itself makes no requests.
    const foot = el('p', 'small foot');
    const site = el('a', '');
    site.href = config.siteUrl;
    site.target = '_blank';
    site.rel = 'noopener noreferrer';
    site.textContent = 'Check for a newer version';
    foot.append(`Version ${VERSION} · `, site);

    this.#body.append(this.#status, this.#chips, this.#notesBox, keys, display, ...(this.#regionUi ? [this.#regionUi.section] : []), step, time, issues, foot);
    panel.append(header, this.#body);
    return panel;
  }

  #setMinimised(min: boolean): void {
    this.#body.hidden = min;
    this.#panel.classList.toggle('min', min);
    const label = min ? 'Expand panel' : 'Minimise panel';
    this.#minButton.setAttribute('aria-label', label);
    this.#minButton.title = label;
    this.#minButton.setAttribute('aria-expanded', String(!min));
    this.#minButton.replaceChildren(icon(min ? ICONS.plus : ICONS.minus));
  }

  #buildTimeSection(section: HTMLElement): void {
    const row = el('div', 'row');
    const label = el('label', 'grow');
    this.#targetSelect = el('select', '');
    this.#targetSelect.addEventListener('change', () => this.#setTarget(Number(this.#targetSelect.value), false));
    label.append('Target ', this.#targetSelect);
    this.#pickButton = button('Pick on page', () => this.#startPicking());
    row.append(label, this.#pickButton);
    this.#pickHint = el('p', 'small');
    this.#pickHint.setAttribute('aria-live', 'polite');

    const table = el('table', '');
    const head = el('thead', '');
    const hr = el('tr', '');
    for (const h of ['Profile', 'To reach', 'Whole page']) {
      const th = el('th', '');
      th.scope = 'col';
      th.textContent = h;
      hr.append(th);
    }
    head.append(hr);
    this.#timeBody = el('tbody', '');
    table.append(head, this.#timeBody);

    this.#timeNotes = el('div', '');
    const how = el('details', 'issue');
    const howSummary = el('summary', '');
    howSummary.textContent = 'How this is estimated';
    const formula = el('p', 'small');
    formula.textContent =
      'Each Tab stop costs one key press, plus time to hear the screen reader announce it (words ÷ speech rate), ' +
      'or for sighted users, time to spot the focus on screen. Time to reach = the sum for every stop up to the target. ' +
      'Change the numbers in config/defaults.json.';
    this.#basisList = el('ul', 'small basis');
    how.append(howSummary, formula, this.#basisList);
    const caveat = el('p', 'small');
    caveat.textContent = 'A model, not a measurement. Real times vary a lot between people, devices and screen readers.';
    section.append(row, this.#pickHint, table, this.#timeNotes, how, caveat);
  }

  /** Fills the target list and picks a default: the first stop in <main>, else the last stop. */
  #renderTime(r: ScanResult): void {
    const { stops } = r.order;
    this.#targetSelect.replaceChildren(
      ...stops.map((s) => {
        const o = el('option', '');
        o.value = String(s.index);
        o.textContent = `${s.index}. ${s.label}`;
        return o;
      }),
    );
    this.#basisList.replaceChildren(
      ...PROFILES.map((p) => {
        const li = el('li', '');
        const b = el('strong', '');
        b.textContent = `${p.label}: `;
        li.append(b, `${p.secondsPerTab} s per Tab` + (p.wordsPerMinute ? `, ${p.wordsPerMinute} words/min` : '') +
          (p.maxWordsHeard ? `, hears first ${p.maxWordsHeard} words` : '') +
          (p.visualSecondsPerStop ? `, ${p.visualSecondsPerStop} s to spot focus` : '') + `. ${p.basis}`);
        return li;
      }),
    );
    const main = document.querySelector('main, [role=main]');
    const inMain = main ? stops.find((s) => contains(main, s.element)) : undefined;
    const fallback = inMain ?? stops[stops.length - 1];
    if (fallback) this.#setTarget(fallback.index, false);
    else this.#timeBody.replaceChildren();
  }

  #setTarget(index: number, announce: boolean): void {
    const r = this.#result;
    const target = r?.order.stops[index - 1];
    if (!r || !target) return;
    this.#targetSelect.value = String(index);
    const rows = estimate(r, target).map((e) => {
      const tr = el('tr', '');
      const th = el('th', '');
      th.scope = 'row';
      th.textContent = e.profileLabel;
      const reach = el('td', '');
      reach.textContent = `${formatSeconds(e.reach)} (${e.reachStops} stop${e.reachStops === 1 ? '' : 's'})`;
      const total = el('td', '');
      total.textContent = formatSeconds(e.total);
      tr.append(th, reach, total);
      return tr;
    });
    this.#timeBody.replaceChildren(...rows);

    const notes: HTMLElement[] = [];
    const ann = r.announcements.get(target);
    if (ann) notes.push(textP(`Announced roughly as “${ann.text}” (${ann.words} words).`, 'small'));
    const first = estimate(r, target)[0];
    if (first.suggestedStops === null) {
      notes.push(textP('This stop is not visible, so it has no place in the suggested order. Removing it from the Tab order saves every user a stop.'));
    } else if (first.suggestedStops !== first.reachStops) {
      const diff = first.reachStops - first.suggestedStops;
      notes.push(textP(
        `Suggested order: ${first.suggestedStops} stop${first.suggestedStops === 1 ? '' : 's'} instead of ${first.reachStops} ` +
        `(${diff > 0 ? `${diff} fewer` : `${-diff} more, since it comes later in reading order`}; ` +
        `${formatSeconds(Math.abs(first.reach - (first.suggestedReach ?? first.reach)))} ${diff > 0 ? 'saved' : 'added'} for a keyboard user).`,
      ));
    }
    const skip = skipLinkEstimate(r);
    if (skip) {
      const kb = skip.perProfile[0];
      const sr = skip.perProfile[1];
      const saved = (p: { without: number; with: number }) => formatSeconds(Math.max(0, p.without - p.with));
      notes.push(textP(
        (skip.hasSkipLink ? 'The skip link' : 'A skip link would') +
        ` cut reaching “${skip.target}” from ${skip.stopsWithout} Tab presses to ${skip.pressesWith} key presses: ` +
        `about ${saved(kb)} saved for a sighted keyboard user and ${saved(sr)} for an everyday screen reader user, on every page visit.`,
      ));
    }
    this.#timeNotes.replaceChildren(...notes);
    if (announce) this.#pickHint.textContent = `Target set to stop ${index}: ${target.label}.`;
  }

  /** Next click on the page chooses the target. The click is swallowed so links do not navigate. */
  #startPicking(): void {
    if (this.#picking) return this.#stopPicking('Picking cancelled.');
    this.#picking = true;
    this.#pickButton.textContent = 'Cancel picking';
    this.#pickHint.textContent = 'Click a link, button or field on the page. Press Escape to cancel.';
    document.addEventListener('click', this.#onPickClick, true);
    document.addEventListener('keydown', this.#onPickKey, true);
  }

  #stopPicking(message: string): void {
    this.#picking = false;
    this.#pickButton.textContent = 'Pick on page';
    this.#pickHint.textContent = message;
    document.removeEventListener('click', this.#onPickClick, true);
    document.removeEventListener('keydown', this.#onPickKey, true);
  }

  readonly #onPickKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') this.#stopPicking('Picking cancelled.');
  };

  readonly #onPickClick = (e: MouseEvent) => {
    const path = e.composedPath();
    if (path.includes(this.#host) || !this.#result) return; // clicks on our own panel work normally
    e.preventDefault();
    e.stopImmediatePropagation();
    const stops = this.#result.order.stops;
    for (const node of path) {
      const stop = stops.find((s) => s.element === node);
      if (stop) {
        this.#stopPicking('');
        this.#setTarget(stop.index, true);
        this.#focusOn([stop.element]);
        return;
      }
    }
    this.#stopPicking('That is not a Tab stop. Choose “Pick on page” again and click a link, button or field.');
  };

  #applyDisplay(): void {
    const p = PALETTES[this.#palette] ?? Object.values(PALETTES)[0];
    const s = SIZES[this.#size] ?? Object.values(SIZES)[0];
    const vars: Record<string, string> = {
      '--real': p.real, '--real-text': p.realText, '--sugg': p.suggested, '--sugg-text': p.suggestedText, '--halo': p.halo,
      '--badge': `${s.badge}px`, '--font': `${s.font}px`, '--stroke': `${s.stroke}px`,
      '--stroke-jump': `${s.stroke * 2}px`, '--halo-w': `${s.stroke + 3}px`, '--shadow-w': `${s.stroke + 5}px`,
    };
    for (const [k, v] of Object.entries(vars)) this.#wrap.style.setProperty(k, v);
    this.#layout();
  }

  #render(): void {
    const r = this.#result!;
    const { stops } = r.order;
    const hiddenCount = stops.filter((s) => s.hidden).length;
    this.#status.textContent =
      `${stops.length} Tab stop${stops.length === 1 ? '' : 's'}` + (hiddenCount ? `, ${hiddenCount} focusable but not visible` : '') + '.';
    this.#notesBox.replaceChildren(...r.order.notes.map((n) => textP(n, 'small')));
    this.#renderChips(r);

    this.#realBox.replaceChildren();
    this.#realBadges = stops.map((s) => {
      const b = el('div', s.hidden ? 'badge hidden-stop' : 'badge');
      b.textContent = String(s.index);
      this.#realBox.append(b);
      return b;
    });
    this.#suggBox.replaceChildren();
    this.#suggBadges = r.suggested.map((_, i) => {
      const b = el('div', 'sbadge');
      b.textContent = String(i + 1);
      this.#suggBox.append(b);
      return b;
    });
    if (!__LITE__) {
      if (!this.#detailChosen) {
        this.#detail = stops.length > config.regions.autoThreshold ? 'regions' : 'stops';
        for (const input of this.#regionUi!.radios) input.checked = input.value === this.#detail;
      }
      this.#expanded = null;
      this.#regionLabels = makeRegionLabels(KIT, this.#regionBox, r.regions, (g) => this.#expand(g));
      this.#renderRegionList();
    } else if (stops.length > config.regions.autoThreshold) {
      this.#notesBox.append(textP('This is the Firefox version of the bookmarklet, which leaves out the Region view so it fits Firefox\'s bookmark size limit. For busy pages, use the browser extension.', 'small'));
    }
    this.#renderIssues(r);
    this.#renderTime(r);
    this.#layout();
  }

  /** Panel list of regions; each button expands that region to show its stops. */
  #renderRegionList(): void {
    if (!__LITE__) {
      if (!this.#result || !this.#regionUi) return;
      renderRegionList(KIT, this.#regionUi, this.#result.regions, this.#expanded, (g) => this.#expand(this.#expanded === g ? null : g));
    }
  }

  /** Shows one region's stops in detail (others hidden), or all regions again with null. */
  #expand(region: Region | null): void {
    if (!__LITE__) {
      this.#expanded = region;
      if (region) {
        if (this.#detail !== 'regions') {
          this.#detail = 'regions';
          for (const input of this.#regionUi!.radios) input.checked = input.value === 'regions';
        }
        (region.element ?? region.stops[0].element).scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
      this.#renderRegionList();
      this.#layout();
    }
  }

  /** Severity counts as text chips ("2 Fail"), never colour alone. */
  #renderChips(r: ScanResult): void {
    const counts = { fail: 0, review: 0, advice: 0 } as Record<Severity, number>;
    for (const i of r.issues) counts[i.severity]++;
    const chips = (['fail', 'review', 'advice'] as Severity[])
      .filter((s) => counts[s])
      .map((s) => {
        const c = el('span', `chip ${s}`);
        c.textContent = `${counts[s]} ${SEVERITY_LABEL[s]}`;
        return c;
      });
    if (!chips.length) {
      const ok = el('span', 'chip ok');
      ok.textContent = 'No issues found by the automated checks';
      chips.push(ok);
    }
    this.#chips.replaceChildren(...chips);
  }

  #renderIssues(r: ScanResult): void {
    this.#issuesTitle.textContent = `Issues (${r.issues.length})`;
    const notes = ['Automated checks find some problems, not all. "Suggested" results are heuristics: check them.'];
    if (r.axe === 'not-included') notes.push('axe-core checks are not in the bookmarklet build; use the extension build to include them.');
    if (r.axe === 'error') notes.push(`axe-core failed to run: ${r.axeMessage ?? 'unknown error'}.`);
    this.#issuesNote.textContent = notes.join(' ');
    this.#issuesList.replaceChildren(...r.issues.map((i) => this.#issueItem(i)));
  }

  #issueItem(issue: Issue): HTMLLIElement {
    const li = el('li', '');
    const details = el('details', 'issue');
    const summary = el('summary', '');
    const sev = el('span', `sev ${issue.severity}`);
    sev.textContent = SEVERITY_LABEL[issue.severity];
    // The space keeps "Fail" and the title as separate words for screen readers.
    const count = issue.elements.length > 1 && issue.rule !== 'order-jump' ? ` (${issue.elements.length})` : '';
    summary.append(sev, ` ${issue.title}${count}`);
    const what = el('p', '');
    what.textContent = issue.summary;
    const fix = el('p', '');
    const strong = el('strong', '');
    strong.textContent = 'How to fix: ';
    fix.append(strong, issue.fix);
    details.append(summary, what, fix);
    if (issue.note) {
      const note = el('p', 'small');
      note.textContent = issue.note;
      details.append(note);
    }
    if (issue.wcag.length) {
      const w = el('p', 'small');
      w.append(issue.severity === 'advice' ? 'Related WCAG (not a failure on its own): ' : 'WCAG: ');
      issue.wcag.forEach((sc, n) => {
        const info = WCAG[sc];
        if (n) w.append(', ');
        if (!info) return void w.append(sc);
        const a = el('a', '');
        a.href = `https://www.w3.org/WAI/WCAG22/Understanding/${info.slug}.html`;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.textContent = `${sc} ${info.name} (${info.level})`;
        w.append(a);
      });
      details.append(w);
    }
    const src = el('p', 'small');
    src.append(`Found by: ${issue.source === 'axe' ? 'axe-core' : 'this tool'}`);
    if (issue.moreInfo) {
      const a = el('a', '');
      a.href = issue.moreInfo;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = 'rule details';
      src.append(' (', a, ')');
    }
    details.append(src);
    if (issue.elements.length) {
      const shows = el('div', 'buttons');
      issue.elements.slice(0, MAX_SHOW_BUTTONS).forEach((e, n) => {
        shows.append(button(`Show “${issue.labels[n]}”`, () => this.#focusOn([e])));
      });
      if (issue.elements.length > MAX_SHOW_BUTTONS) shows.append(`and ${issue.elements.length - MAX_SHOW_BUTTONS} more`);
      details.append(shows);
    }
    li.append(details);
    return li;
  }

  #stepBy(delta: number): void {
    if (!this.#result) return;
    const seq = this.#view === 'suggested' ? this.#result.suggested : this.#result.order.stops;
    if (!seq.length) return;
    this.#step = this.#step < 0 ? (delta > 0 ? 0 : seq.length - 1) : (this.#step + delta + seq.length) % seq.length;
    const s = seq[this.#step];
    this.#stepOut.textContent =
      this.#view === 'suggested'
        ? `Suggested ${this.#step + 1} of ${seq.length}: ${s.label}. Currently Tab stop ${s.index}.`
        : `Stop ${s.index} of ${seq.length}: ${s.label}. ${s.reasons.join(' ')}`;
    this.#focusOn([s.element]);
    this.#setTarget(s.index, false);
  }

  /** Highlights elements and scrolls the first into view (does not move keyboard focus). */
  #focusOn(els: Element[]): void {
    this.#highlight = els;
    els[0]?.scrollIntoView({ block: 'center', inline: 'nearest' });
    this.#layout();
  }

  // ---------------------------------------------------------------- drawing

  #layout(): void {
    if (!this.#result || this.#layer.hidden) return;
    const { order, suggested, jumps } = this.#result;
    const showReal = this.#view !== 'suggested';
    const showSugg = this.#view !== 'real';
    this.#realBox.hidden = !showReal;
    this.#suggBox.hidden = !showSugg;

    const size = SIZES[this.#size] ?? Object.values(SIZES)[0];
    const R = size.badge / 2;
    const docW = document.documentElement.scrollWidth;
    const docH = document.documentElement.scrollHeight;
    this.#layer.style.width = `${docW}px`;
    this.#layer.style.height = `${docH}px`;
    this.#svg.setAttribute('width', String(docW));
    this.#svg.setAttribute('height', String(docH));

    const cache = new Map<Element, DOMRect>();
    const box = (e: Element) => {
      let r = cache.get(e);
      if (!r) {
        const v = e.getBoundingClientRect();
        r = new DOMRect(v.left + window.scrollX, v.top + window.scrollY, v.width, v.height);
        cache.set(e, r);
      }
      return r;
    };
    const cx = (x: number) => Math.min(Math.max(x, R + 3), docW - R - 3);
    const cy = (y: number) => Math.min(Math.max(y, R + 3), docH - R - 3);
    // Real badges sit just outside the element's top-left corner so they do not cover text.
    const realPos = (s: Stop): Pt => {
      const r = box(s.element);
      const inside = r.left - 2 * R - 3 < 0;
      return inside ? [cx(r.left + R), cy(r.top - R - 3)] : [cx(r.left - R - 3), cy(r.top + Math.min(R, r.height / 2))];
    };
    // Suggested badges sit just outside the top-right corner.
    const suggPos = (s: Stop): Pt => {
      const r = box(s.element);
      const inside = r.right + 2 * R + 3 > docW;
      return inside ? [cx(r.right - R), cy(r.bottom + R + 3)] : [cx(r.right + R + 3), cy(r.top + Math.min(R, r.height / 2))];
    };

    this.#svg.replaceChildren(arrowheads());
    if (this.#dim) this.#svg.append(svgEl('rect', { class: 'dim', x: '0', y: '0', width: String(docW), height: String(docH) }));

    const overview = !__LITE__ && this.#detail === 'regions' && !this.#expanded;
    this.#regionBox.hidden = !overview;
    if (!__LITE__ && overview) {
      // Region overview: one box per region and arrows for the order Tab moves between them.
      this.#realBox.hidden = true;
      this.#suggBox.hidden = true;
      drawOverview(KIT, this.#svg, this.#result.regions, this.#regionLabels, box, docW, docH, this.#arrows);
    } else {
      // Stop detail: everything, or only the expanded region's stops.
      const only = this.#expanded ? new Set(this.#expanded.stops) : null;
      if (!__LITE__ && this.#expanded) {
        const r = regionRect(this.#expanded, box);
        if (r) drawRegion(KIT, this.#svg, this.#expanded, r);
      }
      const realStops = only ? order.stops.filter((s) => only.has(s)) : order.stops;
      const suggStops = only ? suggested.filter((s) => only.has(s)) : suggested;
      const realPts = realStops.map(realPos);
      const suggPts = suggStops.map(suggPos);
      this.#groupBadges(order.stops, only, realPos, R);
      this.#suggBadges.forEach((b, i) => {
        const s = suggested[i];
        if (only && !only.has(s)) return void (b.style.display = 'none');
        b.style.display = '';
        const [x, y] = suggPos(s);
        place(b, x, y);
      });
      if (this.#outlines) {
        for (const s of showReal ? realStops : suggStops) {
          const r = box(s.element);
          if (r.width < 1 && r.height < 1) continue;
          const a = { x: String(r.left - 2), y: String(r.top - 2), width: String(r.width + 4), height: String(r.height + 4), rx: '3' };
          this.#svg.append(svgEl('rect', { ...a, class: 'outline-halo' }), svgEl('rect', { ...a, class: s.hidden ? 'outline hidden-stop' : 'outline' }));
        }
      }
      // Jump markers are keyed by real stop index; map them onto this (possibly filtered) list.
      const realJumps = new Set<number>();
      realStops.forEach((s, i) => {
        const next = realStops[i + 1];
        if (next && jumps.has(s.index) && next.index === s.index + 1) realJumps.add(i + 1);
      });
      if (this.#arrows && showSugg) this.#drawPath(suggPts, R, 'sugg', new Set());
      if (this.#arrows && showReal) this.#drawPath(realPts, R, 'real', realJumps);
    }
    for (const e of this.#highlight) {
      const r = box(e);
      const a = { x: String(r.left - 5), y: String(r.top - 5), width: String(r.width + 10), height: String(r.height + 10), rx: '4' };
      this.#svg.append(svgEl('rect', { ...a, class: 'shadow', transform: 'translate(1.2 1.8)' }), svgEl('rect', { ...a, class: 'hl-halo' }), svgEl('rect', { ...a, class: 'hl' }));
    }
  }

  /**
   * Places the real-order badges. Badges that would sit on top of each other are merged into
   * one ("706–763 (4)") so stacked numbers stay readable on dense pages.
   */
  #groupBadges(stops: Stop[], only: Set<Stop> | null, pos: (s: Stop) => Pt, R: number): void {
    const near = R * 1.6;
    // A badge joins a group if it is close to any member, so a run of overlapping badges
    // becomes one group even when the first and last are further apart.
    const groups: { pts: Pt[]; first: number; last: number; count: number; badge: HTMLDivElement }[] = [];
    stops.forEach((s, i) => {
      const badge = this.#realBadges[i];
      if (!badge) return;
      if (only && !only.has(s)) return void (badge.style.display = 'none');
      const [x, y] = pos(s);
      const g = groups.find((g) => g.pts.some(([gx, gy]) => Math.abs(gx - x) < near && Math.abs(gy - y) < near));
      if (g) {
        g.last = s.index;
        g.count++;
        g.pts.push([x, y]);
        badge.style.display = 'none';
        return;
      }
      badge.style.display = '';
      place(badge, x, y);
      groups.push({ pts: [[x, y]], first: s.index, last: s.index, count: 1, badge });
    });
    for (const g of groups) {
      g.badge.textContent = g.count > 1 ? `${g.first}–${g.last} (${g.count})` : String(g.first);
      g.badge.classList.toggle('grouped', g.count > 1);
    }
  }

  #drawPath(pts: Pt[], R: number, kind: 'real' | 'sugg', jumps: Set<number>): void {
    for (let i = 0; i + 1 < pts.length; i++) {
      const jump = kind === 'real' && jumps.has(i + 1);
      // "Long jumps only": skip short hops between neighbours, but never hide a backward jump.
      if (this.#longOnly && !jump && Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]) < config.regions.longJumpPx) continue;
      const c = curve(pts[i], pts[i + 1], R);
      if (!c) continue;
      this.#svg.append(
        // Soft offset shadow under the white halo lifts the arrow off the page and separates crossings.
        svgEl('path', { class: 'shadow', d: c.d, transform: 'translate(1.2 1.8)' }),
        svgEl('path', { class: 'halo', d: c.d }),
        svgEl('path', { class: jump ? 'real jump' : kind, d: c.d, 'marker-end': `url(#tov-head-${kind})` }),
      );
      if (jump) {
        const [mx, my] = c.mid;
        const t = svgEl('text', { class: 'pill-text', x: mx.toFixed(1), y: (my + 3.8).toFixed(1), 'text-anchor': 'middle' });
        t.textContent = 'back';
        this.#svg.append(svgEl('rect', { class: 'pill', x: (mx - 18).toFixed(1), y: (my - 8).toFixed(1), width: '36', height: '16', rx: '8' }), t);
      }
    }
  }
}

/** A gentle quadratic curve between badge centres, trimmed to the badge edges. */
function curve(a: Pt, b: Pt, R: number): { d: string; mid: Pt } | null {
  const [x1, y1] = a;
  const [x2, y2] = b;
  const dist = Math.hypot(x2 - x1, y2 - y1);
  if (dist < R * 2 + 4) return null;
  const bend = Math.min(80, dist * 0.2);
  const cx = (x1 + x2) / 2 + (-(y2 - y1) / dist) * bend;
  const cy = (y1 + y2) / 2 + ((x2 - x1) / dist) * bend;
  const trim = (px: number, py: number, by: number): Pt => {
    const len = Math.hypot(cx - px, cy - py) || 1;
    return [px + ((cx - px) / len) * by, py + ((cy - py) / len) * by];
  };
  const [sx, sy] = trim(x1, y1, R + 1);
  const [ex, ey] = trim(x2, y2, R + 3);
  const f = (n: number) => n.toFixed(1);
  return { d: `M${f(sx)} ${f(sy)} Q${f(cx)} ${f(cy)} ${f(ex)} ${f(ey)}`, mid: [(sx + 2 * cx + ex) / 4, (sy + 2 * cy + ey) / 4] };
}

function arrowheads(): SVGDefsElement {
  const defs = document.createElementNS(SVG_NS, 'defs');
  for (const kind of ['real', 'sugg']) {
    const marker = svgEl('marker', {
      id: `tov-head-${kind}`, viewBox: '0 0 10 10', refX: '8', refY: '5',
      markerWidth: '6', markerHeight: '6', orient: 'auto-start-reverse',
    });
    marker.append(svgEl('path', { d: 'M0 0 L10 5 L0 10 z', class: `head-${kind}` }));
    defs.append(marker);
  }
  return defs;
}

function place(b: HTMLElement | undefined, x: number, y: number): void {
  if (!b) return;
  b.style.left = `${x}px`;
  b.style.top = `${y}px`;
}

function applyStyles(root: ShadowRoot): void {
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(STYLE + (__LITE__ ? '' : REGION_CSS));
    root.adoptedStyleSheets = [sheet];
  } catch {
    const style = document.createElement('style');
    style.textContent = STYLE + (__LITE__ ? '' : REGION_CSS);
    root.append(style);
  }
}

function svgEl(tag: string, attrs: Record<string, string>): SVGElement {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  return e;
}

function button(text: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', '');
  b.type = 'button';
  b.textContent = text;
  b.addEventListener('click', onClick);
  return b;
}

function radio(name: string, value: string, text: string, checked: boolean, onPick: () => void): HTMLLabelElement {
  const label = el('label', '');
  const input = el('input', '');
  input.type = 'radio';
  input.name = name;
  input.value = value;
  input.checked = checked;
  input.addEventListener('change', () => input.checked && onPick());
  label.append(input, ` ${text}`);
  return label;
}

function checkbox(text: string, checked: boolean, onChange: (v: boolean) => void): HTMLLabelElement {
  const label = el('label', '');
  const input = el('input', '');
  input.type = 'checkbox';
  input.checked = checked;
  input.addEventListener('change', () => onChange(input.checked));
  label.append(input, ` ${text}`);
  return label;
}

function select(text: string, options: [string, string][], value: string, onChange: (v: string) => void): HTMLLabelElement {
  const label = el('label', '');
  const s = el('select', '');
  for (const [v, t] of options) {
    const o = el('option', '');
    o.value = v;
    o.textContent = t;
    s.append(o);
  }
  s.value = value;
  s.addEventListener('change', () => onChange(s.value));
  label.append(`${text} `, s);
  return label;
}

/** 16×16 stroke icons (paths only; drawn with currentColor). */
const ICONS = {
  eye: ['M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8Z', 'M8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z'],
  eyeOff: ['M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8Z', 'M2.5 2.5l11 11'],
  refresh: ['M13.5 8a5.5 5.5 0 1 1-1.7-4', 'M13.5 2.5v3h-3'],
  move: ['M2 8h12', 'M5 5 2 8l3 3', 'M11 5l3 3-3 3'],
  minus: ['M3.5 8h9'],
  plus: ['M3.5 8h9', 'M8 3.5v9'],
  close: ['M4 4l8 8', 'M12 4l-8 8'],
};

function icon(paths: string[]): SVGSVGElement {
  const s = document.createElementNS(SVG_NS, 'svg');
  s.setAttribute('viewBox', '0 0 16 16');
  s.setAttribute('aria-hidden', 'true');
  for (const d of paths) s.append(svgEl('path', { d }));
  return s;
}

function iconButton(label: string, paths: string[], onClick: () => void): HTMLButtonElement {
  const b = el('button', 'icon');
  b.type = 'button';
  b.setAttribute('aria-label', label);
  b.title = label;
  b.append(icon(paths));
  b.addEventListener('click', onClick);
  return b;
}

/** A collapsible panel section, open by default. Returns [details, summary]. */
function section(title: string): [HTMLDetailsElement, HTMLElement] {
  const d = el('details', 'sect');
  d.open = true;
  const s = el('summary', '');
  s.textContent = title;
  d.append(s, el('div', 'content'));
  return [d, s];
}

function keyItem(swatch: HTMLElement, text: string): HTMLSpanElement {
  const s = el('span', '');
  s.append(swatch, text);
  return s;
}

const KIT: Kit = { el, button, radio, section, svgEl, curve, place };

function textP(text: string, className = ''): HTMLParagraphElement {
  const p = el('p', className);
  p.textContent = text;
  return p;
}

function sample(text: string, kind: 'real' | 'sugg' | 'hidden-stop'): HTMLSpanElement {
  const s = el('span', `sample ${kind}`);
  s.textContent = text;
  return s;
}
