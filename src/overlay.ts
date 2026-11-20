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

interface Palette { label: string; real: string; realText: string; suggested: string; suggestedText: string; halo: string }
interface Size { label: string; badge: number; font: number; stroke: number }
type View = 'real' | 'suggested' | 'both';
type Pt = readonly [number, number];

const PALETTES = config.display.palettes as Record<string, Palette>;
const SIZES = config.display.sizes as Record<string, Size>;
const WCAG = wcag as Record<string, { name: string; level: string; url: string }>;
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
.layer { position: absolute; top: 0; left: 0; pointer-events: none; }
.layer[hidden], .box[hidden] { display: none; }
svg { position: absolute; top: 0; left: 0; overflow: visible; }
.dim { fill: rgba(0, 0, 0, 0.35); }
.halo { fill: none; stroke: var(--halo); stroke-width: var(--halo-w); stroke-linecap: round; }
.real { fill: none; stroke: var(--real); stroke-width: var(--stroke); stroke-linecap: round; }
.real.jump { stroke-width: var(--stroke-jump); }
.sugg { fill: none; stroke: var(--sugg); stroke-width: var(--stroke); stroke-dasharray: 7 5; }
.outline { fill: none; stroke: var(--real); stroke-width: 1.5px; }
.outline.hidden-stop { stroke-dasharray: 3 3; }
.outline-halo { fill: none; stroke: var(--halo); stroke-width: 4px; }
.hl { fill: none; stroke: var(--real); stroke-width: 4px; }
.hl-halo { fill: none; stroke: var(--halo); stroke-width: 9px; }
.head-real { fill: var(--real); }
.head-sugg { fill: var(--sugg); }
.jump-label { font: 700 12px system-ui, -apple-system, "Segoe UI", sans-serif; fill: var(--real);
  stroke: var(--halo); stroke-width: 4px; paint-order: stroke; }
.badge, .sbadge {
  position: absolute; transform: translate(-50%, -50%); box-sizing: border-box;
  min-width: var(--badge); height: var(--badge); padding: 0 4px; white-space: nowrap; text-align: center;
  font: 700 var(--font)/calc(var(--badge) - 4px) system-ui, -apple-system, "Segoe UI", sans-serif;
  border: 2px solid var(--halo);
}
.badge { border-radius: calc(var(--badge) / 2); background: var(--real); color: var(--real-text); box-shadow: 0 0 0 1px var(--real); }
.badge.hidden-stop { background: var(--halo); color: var(--real); border: 2px dashed var(--real); }
.sbadge { border-radius: 2px; background: var(--sugg); color: var(--sugg-text); box-shadow: 0 0 0 1px var(--sugg); }
.panel {
  position: fixed; right: 12px; bottom: 12px; width: 340px; max-height: calc(100vh - 24px); overflow: auto;
  box-sizing: border-box; pointer-events: auto; background: #ffffff; color: #111111;
  border: 2px solid #1a1a5e; border-radius: 6px; padding: 10px 12px; box-shadow: 0 2px 10px rgba(0,0,0,.25);
  font: 14px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; text-align: left;
}
.panel.left { right: auto; left: 12px; }
.panel:focus { outline: 3px solid #1a1a5e; outline-offset: 2px; }
@media (forced-colors: active) {
  .layer { forced-color-adjust: none; }
  .panel { border-color: CanvasText; }
}
.panel p { margin: 0 0 6px; }
.panel a { color: #1a1a5e; }
.title { font-weight: 700; font-size: 15px; }
.section { border-top: 1px solid #c8c8d8; margin-top: 8px; padding-top: 8px; }
.small { font-size: 12px; color: #333333; }
fieldset { border: 0; margin: 0 0 6px; padding: 0; }
legend { padding: 0; font-weight: 600; }
.row { display: flex; flex-wrap: wrap; gap: 4px 12px; align-items: center; margin-bottom: 6px; }
label { cursor: pointer; }
select { font: inherit; font-size: 13px; max-width: 100%; }
.row > label { max-width: 100%; }
.sample { display: inline-block; min-width: 18px; height: 18px; box-sizing: border-box; padding: 0 3px; vertical-align: middle;
  font: 700 11px/14px system-ui, sans-serif; text-align: center; border: 2px solid #1a1a5e; }
.sample.real { border-radius: 9px; background: #1a1a5e; color: #fff; }
.sample.hidden-stop { border-radius: 9px; background: #fff; color: #1a1a5e; border-style: dashed; }
.sample.sugg { border-radius: 2px; background: #b0006a; border-color: #b0006a; color: #fff; }
.buttons { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 6px; }
button {
  font: inherit; font-size: 13px; padding: 3px 9px; border-radius: 4px; cursor: pointer;
  border: 1px solid #1a1a5e; background: #ffffff; color: #1a1a5e;
}
button:hover { background: #eef0ff; }
button:focus-visible, input:focus-visible, select:focus-visible, summary:focus-visible, a:focus-visible {
  outline: 3px solid #1a1a5e; outline-offset: 2px;
}
ul { list-style: none; margin: 0; padding: 0; }
li { margin: 0 0 6px; }
details { border: 1px solid #c8c8d8; border-radius: 4px; padding: 4px 6px; }
summary { cursor: pointer; }
.sev { display: inline-block; min-width: 46px; margin-right: 4px; padding: 0 4px; border-radius: 3px;
  font-size: 11px; font-weight: 700; text-align: center; text-transform: uppercase; border: 1px solid; }
.sev.fail { background: #fde8e8; color: #8a1010; }
.sev.review { background: #fff4d6; color: #6b4a00; }
table { border-collapse: collapse; width: 100%; margin: 6px 0; font-size: 13px; }
th, td { text-align: left; padding: 3px 4px; border-bottom: 1px solid #d8d8e4; vertical-align: top; }
thead th { font-size: 12px; color: #333333; }
tbody th { font-weight: 600; }
.basis { padding-left: 16px; list-style: disc; }
.basis li { margin-bottom: 4px; }
.sev.advice { background: #e8f0fe; color: #1a3d8a; }
@media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }
`;

export class Overlay {
  private host: HTMLElement;
  private wrap: HTMLDivElement;
  private layer: HTMLDivElement;
  private svg: SVGSVGElement;
  private realBox: HTMLDivElement;
  private suggBox: HTMLDivElement;
  private panel!: HTMLDivElement;
  private status!: HTMLParagraphElement;
  private stepOut!: HTMLParagraphElement;
  private notesBox!: HTMLDivElement;
  private issuesTitle!: HTMLParagraphElement;
  private issuesNote!: HTMLParagraphElement;
  private issuesList!: HTMLUListElement;
  private toggleButton!: HTMLButtonElement;
  private targetSelect!: HTMLSelectElement;
  private pickButton!: HTMLButtonElement;
  private pickHint!: HTMLParagraphElement;
  private timeBody!: HTMLTableSectionElement;
  private timeNotes!: HTMLDivElement;
  private basisList!: HTMLUListElement;
  private picking = false;
  private returnTo: Element | null = null;

  private result: ScanResult | null = null;
  private realBadges: HTMLDivElement[] = [];
  private suggBadges: HTMLDivElement[] = [];
  private view: View = 'real';
  private arrows = true;
  private outlines = true;
  private dim = false;
  private palette = config.display.defaultPalette;
  private size = config.display.defaultSize;
  private step = -1;
  private highlight: Element[] = [];
  private generation = 0;
  private frame = 0;
  private resizeObserver: ResizeObserver;
  private readonly schedule = () => {
    if (!this.frame) this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.layout();
    });
  };

  constructor(private runScan: () => Promise<ScanResult>, private onClose: () => void) {
    this.host = document.createElement(OVERLAY_TAG);
    for (const [k, v] of Object.entries({
      position: 'absolute', top: '0', left: '0', width: '0', height: '0', margin: '0', padding: '0',
      border: '0', overflow: 'visible', display: 'block', 'z-index': '2147483647',
    })) this.host.style.setProperty(k, v, 'important');

    const root = this.host.attachShadow({ mode: 'open' });
    applyStyles(root);
    this.wrap = el('div', 'wrap');
    this.layer = el('div', 'layer');
    this.layer.setAttribute('aria-hidden', 'true');
    this.svg = document.createElementNS(SVG_NS, 'svg');
    this.realBox = el('div', 'box');
    this.suggBox = el('div', 'box');
    this.layer.append(this.svg, this.suggBox, this.realBox);
    this.wrap.append(this.layer, this.buildPanel());
    root.append(this.wrap);
    document.documentElement.append(this.host);

    this.applyDisplay();
    window.addEventListener('scroll', this.schedule, { passive: true, capture: true });
    window.addEventListener('resize', this.schedule, { passive: true });
    this.resizeObserver = new ResizeObserver(this.schedule);
    this.resizeObserver.observe(document.body);
    document.addEventListener('keydown', this.onShortcut, true);
    // Keyboard users land in the panel straight away (they just invoked the tool).
    void this.refresh().then(() => this.focusPanel());
  }

  /** Moves focus into the panel, remembering where it was on the page. */
  focusPanel(): void {
    if (!this.host.isConnected) return;
    // While focus is anywhere in our Shadow DOM, the document reports the host as active
    // (Node.contains does not look inside shadow roots, so it cannot answer this).
    if (!this.focusInside()) this.returnTo = deepActive();
    this.panel.focus({ preventScroll: true });
  }

  private focusInside(): boolean {
    return document.activeElement === this.host;
  }

  /** Sends focus back to where it was on the page before the panel took it. */
  private returnFocus(): void {
    const target = this.returnTo as HTMLElement | null;
    this.returnTo = null;
    if (target?.isConnected && typeof target.focus === 'function') target.focus({ preventScroll: true });
    else (document.activeElement as HTMLElement | null)?.blur?.();
  }

  private readonly onShortcut = (e: KeyboardEvent) => {
    if (!matchesShortcut(e, SHORTCUT)) return;
    e.preventDefault();
    e.stopPropagation();
    if (this.focusInside()) this.returnFocus();
    else this.focusPanel();
  };

  setVisible(visible: boolean): void {
    this.layer.hidden = !visible;
    this.toggleButton.textContent = visible ? 'Hide overlay' : 'Show overlay';
    if (visible) this.layout();
  }

  async refresh(): Promise<void> {
    const gen = ++this.generation;
    this.status.textContent = 'Scanning…';
    try {
      const r = await this.runScan();
      if (gen !== this.generation || !this.host.isConnected) return;
      this.result = r;
      this.step = -1;
      this.highlight = [];
      this.render();
    } catch (e) {
      this.status.textContent = `Scan failed: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  destroy(): void {
    this.generation++;
    if (this.picking) this.stopPicking('');
    window.removeEventListener('scroll', this.schedule, { capture: true });
    window.removeEventListener('resize', this.schedule);
    document.removeEventListener('keydown', this.onShortcut, true);
    const hadFocus = this.focusInside();
    this.resizeObserver.disconnect();
    cancelAnimationFrame(this.frame);
    this.host.remove();
    if (hadFocus) this.returnFocus(); // closing from the panel: do not strand keyboard focus
    this.onClose();
  }

  // ---------------------------------------------------------------- panel

  private buildPanel(): HTMLDivElement {
    const panel = (this.panel = el('div', 'panel'));
    panel.setAttribute('role', 'region');
    panel.setAttribute('aria-label', 'Tab order visualizer');
    panel.tabIndex = -1; // focusable by script (on open, shortcut), not an extra Tab stop
    panel.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.picking) {
        e.preventDefault();
        this.returnFocus();
      }
    });

    const title = el('p', 'title');
    title.textContent = 'Tab order';
    const keys = el('p', 'small');
    keys.textContent = `${SHORTCUT_LABEL}: move between the page and this panel. Escape: back to the page.`;
    this.status = el('p', 'status');
    this.status.setAttribute('role', 'status');
    this.notesBox = el('div', 'small');

    const viewSet = el('fieldset', '');
    const legend = el('legend', '');
    legend.textContent = 'Show';
    const viewRow = el('div', 'row');
    for (const [value, text] of [['real', 'Real order'], ['suggested', 'Suggested order'], ['both', 'Both']] as const) {
      viewRow.append(radio('tov-view', value, text, value === this.view, () => {
        this.view = value;
        this.step = -1;
        this.highlight = [];
        this.stepOut.textContent = '';
        this.layout();
      }));
    }
    viewSet.append(legend, viewRow);

    const toggles = el('div', 'row');
    toggles.append(
      checkbox('Arrows', this.arrows, (v) => { this.arrows = v; this.layout(); }),
      checkbox('Outlines', this.outlines, (v) => { this.outlines = v; this.layout(); }),
      checkbox('Dim page', this.dim, (v) => { this.dim = v; this.layout(); }),
    );

    const selects = el('div', 'row');
    selects.append(
      select('Colours', Object.entries(PALETTES).map(([k, p]) => [k, p.label]), this.palette, (v) => { this.palette = v; this.applyDisplay(); }),
      select('Size', Object.entries(SIZES).map(([k, s]) => [k, s.label]), this.size, (v) => { this.size = v; this.applyDisplay(); }),
    );

    const key = el('p', 'small');
    key.append(sample('1', 'real'), ' real Tab order (solid)  ', sample('1', 'sugg'), ' suggested (dashed)  ',
      sample('2', 'hidden-stop'), ' focusable, not visible');

    const step = el('div', 'section');
    const stepTitle = el('p', 'title');
    stepTitle.textContent = 'Step through';
    const stepButtons = el('div', 'buttons');
    stepButtons.append(button('Previous stop', () => this.stepBy(-1)), button('Next stop', () => this.stepBy(1)));
    this.stepOut = el('p', 'small');
    this.stepOut.setAttribute('aria-live', 'polite');
    step.append(stepTitle, stepButtons, this.stepOut);

    const time = this.buildTimeSection();

    const issues = el('div', 'section');
    this.issuesTitle = el('p', 'title');
    this.issuesTitle.textContent = 'Issues';
    this.issuesNote = el('p', 'small');
    this.issuesList = el('ul', '');
    issues.append(this.issuesTitle, this.issuesNote, this.issuesList);

    const actions = el('div', 'buttons section');
    this.toggleButton = button('Hide overlay', () => this.setVisible(this.layer.hidden !== false));
    actions.append(
      this.toggleButton,
      button('Refresh', () => void this.refresh()),
      button('Move panel', () => panel.classList.toggle('left')),
      button('Close', () => this.destroy()),
    );

    panel.append(title, keys, this.status, this.notesBox, viewSet, toggles, selects, key, step, time, issues, actions);
    return panel;
  }

  private buildTimeSection(): HTMLDivElement {
    const section = el('div', 'section');
    const title = el('p', 'title');
    title.textContent = 'Time to reach (estimate)';
    const row = el('div', 'row');
    const label = el('label', '');
    this.targetSelect = el('select', '');
    this.targetSelect.addEventListener('change', () => this.setTarget(Number(this.targetSelect.value), false));
    label.append('Target ', this.targetSelect);
    this.pickButton = button('Pick on page', () => this.startPicking());
    row.append(label, this.pickButton);
    this.pickHint = el('p', 'small');
    this.pickHint.setAttribute('aria-live', 'polite');

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
    this.timeBody = el('tbody', '');
    table.append(head, this.timeBody);

    this.timeNotes = el('div', '');
    const how = el('details', '');
    const howSummary = el('summary', '');
    howSummary.textContent = 'How this is estimated';
    const formula = el('p', 'small');
    formula.textContent =
      'Each Tab stop costs one key press, plus time to hear the screen reader announce it (words ÷ speech rate), ' +
      'or for sighted users, time to spot the focus on screen. Time to reach = the sum for every stop up to the target. ' +
      'Change the numbers in config/defaults.json.';
    this.basisList = el('ul', 'small basis');
    how.append(howSummary, formula, this.basisList);
    const caveat = el('p', 'small');
    caveat.textContent = 'A model, not a measurement. Real times vary a lot between people, devices and screen readers.';
    section.append(title, row, this.pickHint, table, this.timeNotes, how, caveat);
    return section;
  }

  /** Fills the target list and picks a default: the first stop in <main>, else the last stop. */
  private renderTime(r: ScanResult): void {
    const { stops } = r.order;
    this.targetSelect.replaceChildren(
      ...stops.map((s) => {
        const o = el('option', '');
        o.value = String(s.index);
        o.textContent = `${s.index}. ${s.label}`;
        return o;
      }),
    );
    this.basisList.replaceChildren(
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
    if (fallback) this.setTarget(fallback.index, false);
    else this.timeBody.replaceChildren();
  }

  private setTarget(index: number, announce: boolean): void {
    const r = this.result;
    const target = r?.order.stops[index - 1];
    if (!r || !target) return;
    this.targetSelect.value = String(index);
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
    this.timeBody.replaceChildren(...rows);

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
    this.timeNotes.replaceChildren(...notes);
    if (announce) this.pickHint.textContent = `Target set to stop ${index}: ${target.label}.`;
  }

  /** Next click on the page chooses the target. The click is swallowed so links do not navigate. */
  private startPicking(): void {
    if (this.picking) return this.stopPicking('Picking cancelled.');
    this.picking = true;
    this.pickButton.textContent = 'Cancel picking';
    this.pickHint.textContent = 'Click a link, button or field on the page. Press Escape to cancel.';
    document.addEventListener('click', this.onPickClick, true);
    document.addEventListener('keydown', this.onPickKey, true);
  }

  private stopPicking(message: string): void {
    this.picking = false;
    this.pickButton.textContent = 'Pick on page';
    this.pickHint.textContent = message;
    document.removeEventListener('click', this.onPickClick, true);
    document.removeEventListener('keydown', this.onPickKey, true);
  }

  private readonly onPickKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') this.stopPicking('Picking cancelled.');
  };

  private readonly onPickClick = (e: MouseEvent) => {
    const path = e.composedPath();
    if (path.includes(this.host) || !this.result) return; // clicks on our own panel work normally
    e.preventDefault();
    e.stopImmediatePropagation();
    const stops = this.result.order.stops;
    for (const node of path) {
      const stop = stops.find((s) => s.element === node);
      if (stop) {
        this.stopPicking('');
        this.setTarget(stop.index, true);
        this.focusOn([stop.element]);
        return;
      }
    }
    this.stopPicking('That is not a Tab stop. Choose “Pick on page” again and click a link, button or field.');
  };

  private applyDisplay(): void {
    const p = PALETTES[this.palette] ?? Object.values(PALETTES)[0];
    const s = SIZES[this.size] ?? Object.values(SIZES)[0];
    const vars: Record<string, string> = {
      '--real': p.real, '--real-text': p.realText, '--sugg': p.suggested, '--sugg-text': p.suggestedText, '--halo': p.halo,
      '--badge': `${s.badge}px`, '--font': `${s.font}px`, '--stroke': `${s.stroke}px`,
      '--stroke-jump': `${s.stroke * 2}px`, '--halo-w': `${s.stroke + 3}px`,
    };
    for (const [k, v] of Object.entries(vars)) this.wrap.style.setProperty(k, v);
    this.layout();
  }

  private render(): void {
    const r = this.result!;
    const { stops } = r.order;
    const hiddenCount = stops.filter((s) => s.hidden).length;
    this.status.textContent =
      `${stops.length} Tab stop${stops.length === 1 ? '' : 's'}` + (hiddenCount ? `, ${hiddenCount} focusable but not visible` : '') + '.';
    this.notesBox.replaceChildren(...r.order.notes.map((n) => textP(n, 'small')));

    this.realBox.replaceChildren();
    this.realBadges = stops.map((s) => {
      const b = el('div', s.hidden ? 'badge hidden-stop' : 'badge');
      b.textContent = String(s.index);
      this.realBox.append(b);
      return b;
    });
    this.suggBox.replaceChildren();
    this.suggBadges = r.suggested.map((_, i) => {
      const b = el('div', 'sbadge');
      b.textContent = String(i + 1);
      this.suggBox.append(b);
      return b;
    });
    this.renderIssues(r);
    this.renderTime(r);
    this.layout();
  }

  private renderIssues(r: ScanResult): void {
    this.issuesTitle.textContent = `Issues (${r.issues.length})`;
    const notes = ['Automated checks find some problems, not all. "Suggested" results are heuristics: check them.'];
    if (r.axe === 'not-included') notes.push('axe-core checks are not in the bookmarklet build; use the extension build to include them.');
    if (r.axe === 'error') notes.push(`axe-core failed to run: ${r.axeMessage ?? 'unknown error'}.`);
    this.issuesNote.textContent = notes.join(' ');
    this.issuesList.replaceChildren(...r.issues.map((i) => this.issueItem(i)));
  }

  private issueItem(issue: Issue): HTMLLIElement {
    const li = el('li', '');
    const details = el('details', '');
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
        a.href = info.url;
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
        shows.append(button(`Show “${issue.labels[n]}”`, () => this.focusOn([e])));
      });
      if (issue.elements.length > MAX_SHOW_BUTTONS) shows.append(`and ${issue.elements.length - MAX_SHOW_BUTTONS} more`);
      details.append(shows);
    }
    li.append(details);
    return li;
  }

  private stepBy(delta: number): void {
    if (!this.result) return;
    const seq = this.view === 'suggested' ? this.result.suggested : this.result.order.stops;
    if (!seq.length) return;
    this.step = this.step < 0 ? (delta > 0 ? 0 : seq.length - 1) : (this.step + delta + seq.length) % seq.length;
    const s = seq[this.step];
    this.stepOut.textContent =
      this.view === 'suggested'
        ? `Suggested ${this.step + 1} of ${seq.length}: ${s.label}. Currently Tab stop ${s.index}.`
        : `Stop ${s.index} of ${seq.length}: ${s.label}. ${s.reasons.join(' ')}`;
    this.focusOn([s.element]);
    this.setTarget(s.index, false);
  }

  /** Highlights elements and scrolls the first into view (does not move keyboard focus). */
  private focusOn(els: Element[]): void {
    this.highlight = els;
    els[0]?.scrollIntoView({ block: 'center', inline: 'nearest' });
    this.layout();
  }

  // ---------------------------------------------------------------- drawing

  private layout(): void {
    if (!this.result || this.layer.hidden) return;
    const { order, suggested, jumps } = this.result;
    const showReal = this.view !== 'suggested';
    const showSugg = this.view !== 'real';
    this.realBox.hidden = !showReal;
    this.suggBox.hidden = !showSugg;

    const size = SIZES[this.size] ?? Object.values(SIZES)[0];
    const R = size.badge / 2;
    const docW = document.documentElement.scrollWidth;
    const docH = document.documentElement.scrollHeight;
    this.layer.style.width = `${docW}px`;
    this.layer.style.height = `${docH}px`;
    this.svg.setAttribute('width', String(docW));
    this.svg.setAttribute('height', String(docH));

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

    const realPts = order.stops.map(realPos);
    realPts.forEach(([x, y], i) => place(this.realBadges[i], x, y));
    const suggPts = suggested.map(suggPos);
    suggPts.forEach(([x, y], i) => place(this.suggBadges[i], x, y));

    this.svg.replaceChildren(arrowheads());
    if (this.dim) this.svg.append(svgEl('rect', { class: 'dim', x: '0', y: '0', width: String(docW), height: String(docH) }));
    if (this.outlines) {
      for (const s of showReal ? order.stops : suggested) {
        const r = box(s.element);
        if (r.width < 1 && r.height < 1) continue;
        const a = { x: String(r.left - 2), y: String(r.top - 2), width: String(r.width + 4), height: String(r.height + 4), rx: '3' };
        this.svg.append(svgEl('rect', { ...a, class: 'outline-halo' }), svgEl('rect', { ...a, class: s.hidden ? 'outline hidden-stop' : 'outline' }));
      }
    }
    if (this.arrows && showSugg) this.drawPath(suggPts, R, 'sugg', new Set());
    if (this.arrows && showReal) this.drawPath(realPts, R, 'real', jumps);
    for (const e of this.highlight) {
      const r = box(e);
      const a = { x: String(r.left - 5), y: String(r.top - 5), width: String(r.width + 10), height: String(r.height + 10), rx: '4' };
      this.svg.append(svgEl('rect', { ...a, class: 'hl-halo' }), svgEl('rect', { ...a, class: 'hl' }));
    }
  }

  private drawPath(pts: Pt[], R: number, kind: 'real' | 'sugg', jumps: Set<number>): void {
    for (let i = 0; i + 1 < pts.length; i++) {
      const c = curve(pts[i], pts[i + 1], R);
      if (!c) continue;
      const jump = kind === 'real' && jumps.has(i + 1);
      this.svg.append(
        svgEl('path', { class: 'halo', d: c.d }),
        svgEl('path', { class: jump ? 'real jump' : kind, d: c.d, 'marker-end': `url(#tov-head-${kind})` }),
      );
      if (jump) {
        const t = svgEl('text', { class: 'jump-label', x: c.mid[0].toFixed(1), y: c.mid[1].toFixed(1), 'text-anchor': 'middle' });
        t.textContent = 'back';
        this.svg.append(t);
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
    sheet.replaceSync(STYLE);
    root.adoptedStyleSheets = [sheet];
  } catch {
    const style = document.createElement('style');
    style.textContent = STYLE;
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
