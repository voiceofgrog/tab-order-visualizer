/**
 * Computes the sequential focus navigation order (the order the Tab key visits),
 * because no browser API exposes it.
 *
 * How browsers decide (HTML spec, "sequential focus navigation"):
 *  1. Find focusable elements: native controls (links with href, buttons, inputs...),
 *     plus anything with a valid tabindex attribute.
 *  2. Drop the ones Tab skips: tabindex < 0, disabled, inert, not rendered,
 *     visibility: hidden, inside a closed <details>.
 *  3. Group them into "focus navigation scopes": the document, each shadow root,
 *     and each <slot>'s assigned content.
 *  4. Inside each scope: positive tabindex first (ascending, ties in DOM order),
 *     then tabindex 0 / natural elements in DOM order.
 *  5. Flatten: a scope's contents are inserted right after the scope's owner
 *     (shadow host or slot), wherever that owner landed in its parent scope.
 *  6. Extra rules: one stop per radio group; scrollable areas with nothing
 *     focusable inside become stops themselves.
 *
 * Visibility checks follow the approach of the `tabbable` library (computed
 * display/visibility, inert, checkVisibility). The ordering and the
 * per-stop explanations are our own so the tool can say *why*.
 */
import { computeAccessibleName } from 'dom-accessibility-api';
import config from '../config/defaults.json';

export type StopKind = 'element' | 'radio-group' | 'scroller' | 'iframe';

export interface Stop {
  /** 1-based position in the Tab sequence. */
  index: number;
  element: Element;
  label: string;
  tabindex: number;
  kind: StopKind;
  /** Why the element is focusable but not visible, or null if it looks visible. */
  hidden: string | null;
  /** Plain-language reasons for this element's position. */
  reasons: string[];
}

export interface Skipped {
  element: Element;
  label: string;
  reason: string;
  /** Set when the element is skipped only because of a browser-specific rule. */
  code?: 'safari-default';
}

export interface OrderResult {
  stops: Stop[];
  /** Focusable-looking elements that Tab will not visit, with the reason. */
  skipped: Skipped[];
  /** Page-level caveats (modal dialogs, reading-flow, ...). */
  notes: string[];
}

interface Draft {
  element: Element;
  tabindex: number;
  kind: StopKind;
  reasons: string[];
  radioName?: string;
  radioOwner?: Node;
}

/** One entry in a scope: an element's own stop and/or a nested scope it owns. */
interface Item {
  tabindex: number;
  stop?: Draft;
  children?: Item[];
}

interface Ctx {
  inert: boolean;
  closedDetails: boolean;
  /** Human description of the current scope, null for the document. */
  scope: string | null;
}

export const OVERLAY_TAG = 'tab-order-viz';
const MAX_SKIPPED_PER_SUBTREE = 50;

export function computeOrder(root?: Element): OrderResult {
  const skipped: Skipped[] = [];
  const notes: string[] = [];
  const modal = root ? null : findModal();
  if (modal) {
    notes.push(
      'A modal dialog is open. Everything outside it is inert, so only the dialog is analysed.',
    );
  }
  const items: Item[] = [];
  visit(root ?? modal ?? document.body, { inert: false, closedDetails: false, scope: null }, items, skipped, notes);
  const drafts = collapseRadioGroups(flatten(items), skipped);
  const stops = drafts.map((d, i) => toStop(d, i + 1));
  const safariSkipped = skipped.filter((s) => s.code === 'safari-default').length;
  if (ENGINE === 'webkit') {
    notes.push(
      SAFARI_DEFAULT
        ? `Safari rules applied: by default Safari's Tab key only reaches text fields and pop-up menus (plus details summaries and anything with tabindex), ` +
            `so ${safariSkipped} item${safariSkipped === 1 ? ' is' : 's are'} skipped. Option+Tab reaches them. See the README to change this.`
        : 'Safari rules applied (safari.tabToAll is on).',
    );
  }
  return { stops, skipped, notes };
}

/**
 * Which engine's Tab rules to apply. They differ: by default Safari (WebKit) tabs only to text
 * fields and pop-up menus and never to scroll boxes; Chrome, Edge and Firefox tab to everything.
 */
export const ENGINE: 'blink' | 'gecko' | 'webkit' = (() => {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  if (/Firefox\//.test(ua)) return 'gecko';
  if (/Chrome\/|Chromium\/|Edg\//.test(ua)) return 'blink';
  if (/AppleWebKit\//.test(ua)) return 'webkit';
  return 'blink';
})();
const SAFARI_DEFAULT = ENGINE === 'webkit' && !config.safari.tabToAll;
const SAFARI_REASON =
  'Safari tabs only to text fields and menus by default (Option+Tab reaches this)';
const TEXT_INPUT_TYPES = new Set(['text', 'search', 'email', 'url', 'tel', 'password', 'number', 'date', 'datetime-local', 'month', 'time', 'week']);

/**
 * True if default Safari skips this element when tabbing. Explicit tabindex always counts, and
 * Safari also stops on a <details> <summary> (seen in real key presses on macOS).
 */
function safariSkips(el: Element): boolean {
  if (el.hasAttribute('tabindex')) return false;
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement || el.localName === 'summary') return false;
  if (el instanceof HTMLInputElement) return !TEXT_INPUT_TYPES.has(el.type);
  if (el instanceof HTMLElement && el.isContentEditable) return false;
  return true; // links, buttons, checkboxes, radios, media controls, iframes
}

// ---------------------------------------------------------------------------
// Tree walk
// ---------------------------------------------------------------------------

/** Visits `el` and its composed-tree descendants, appending items. Returns stops created. */
function visit(el: Element, ctx: Ctx, items: Item[], skipped: Skipped[], notes: string[]): number {
  if (el.localName === OVERLAY_TAG) return 0;
  if (config.ignoreSelectors.some((s: string) => safeMatches(el, s))) return 0;

  const cs = getComputedStyle(el);
  if (cs.display === 'none') {
    recordSubtree(el, 'not rendered (display: none on it or an ancestor)', skipped);
    return 0;
  }

  const inert = ctx.inert || (el as HTMLElement).inert === true || el.hasAttribute('inert');
  const here: Ctx = { ...ctx, inert };

  const flow = cs.getPropertyValue('reading-flow').trim();
  if (flow && flow !== 'normal') {
    notes.push(
      `${describe(el)} uses reading-flow: ${flow}. Chrome and Edge reorder its children for Tab; ` +
        'Firefox and Safari do not. This tool does not model reading-flow yet, so order inside it may differ in Chromium.',
    );
  }

  const tab = effectiveTabindex(el);
  const item: Item = { tabindex: 0 };
  let count = 0;
  if (tab !== null) {
    const why = notTabbable(el, cs, tab, here);
    if (why) {
      skipped.push({ element: el, label: labelOf(el), reason: why, ...(why === SAFARI_REASON ? { code: 'safari-default' as const } : {}) });
    } else {
      item.stop = makeDraft(el, tab, ctx);
      item.tabindex = tab;
      count++;
    }
  }

  // Shadow host: its light-DOM children are only rendered through slots, so we walk the
  // shadow root instead, as a new scope placed right after the host.
  const shadow = el.shadowRoot;
  if (shadow) {
    if (shadow.delegatesFocus && item.stop) {
      // delegatesFocus: the host hands focus to its first focusable descendant
      // and is not a separate stop.
      item.stop = undefined;
      count--;
    }
    item.tabindex = Math.max(tab ?? 0, 0);
    item.children = [];
    const inner: Ctx = { ...here, scope: `the Shadow DOM of ${describe(el)}` };
    for (const c of Array.from(shadow.children)) count += visit(c, inner, item.children, skipped, notes);
    items.push(item);
    return count;
  }

  // Slot: its assigned (slotted) elements form their own scope where the slot sits.
  if (el instanceof HTMLSlotElement) {
    const assigned = el.assignedElements();
    const kids = assigned.length ? assigned : Array.from(el.children);
    const root = el.getRootNode();
    const owner = root instanceof ShadowRoot ? describe(root.host) : 'its component';
    const inner: Ctx = assigned.length ? { ...here, scope: `content slotted into ${owner}` } : here;
    item.children = [];
    for (const c of kids) count += visit(c, inner, item.children, skipped, notes);
    items.push(item);
    return count;
  }

  // Ordinary element: its own item comes before its descendants (DOM order).
  items.push(item);
  const closedDetails = el instanceof HTMLDetailsElement && !el.open;
  const summary = closedDetails ? Array.from(el.children).find((c) => c.localName === 'summary') : undefined;
  let below = 0;
  for (const c of Array.from(el.children)) {
    const childCtx = closedDetails && c !== summary ? { ...here, closedDetails: true } : here;
    below += visit(c, childCtx, items, skipped, notes);
  }
  count += below;

  // Chrome (130+) and Firefox make a scrollable area with nothing focusable inside a
  // Tab stop, so keyboard users can scroll it.
  // (A hidden scroll box cannot take focus, like any other hidden element.)
  const shown = cs.visibility === 'visible' && (typeof el.checkVisibility !== 'function' || el.checkVisibility());
  if (!item.stop && tab === null && below === 0 && !inert && !ctx.closedDetails && shown && ENGINE !== 'webkit' && isScrollContainer(el, cs)) {
    item.stop = {
      element: el,
      tabindex: 0,
      kind: 'scroller',
      reasons: [
        'This area scrolls but has nothing focusable inside, so the browser makes the area itself a Tab stop ' +
          'so keyboard users can scroll it with the arrow keys.',
        ...scopeReason(ctx),
      ],
    };
    count++;
  }
  return count;
}

/** Flattens scopes into one list: positive tabindex first (ascending), then 0 in DOM order. */
function flatten(items: Item[]): Draft[] {
  const positive = items
    .map((it, i) => ({ it, i }))
    .filter(({ it }) => it.tabindex > 0)
    .sort((a, b) => a.it.tabindex - b.it.tabindex || a.i - b.i)
    .map(({ it }) => it);
  const zero = items.filter((it) => it.tabindex === 0);
  const out: Draft[] = [];
  for (const it of [...positive, ...zero]) {
    if (it.stop) out.push(it.stop);
    if (it.children) out.push(...flatten(it.children));
  }
  return out;
}

/** A radio group is one Tab stop: the checked radio, or the first one if none is checked. */
function collapseRadioGroups(drafts: Draft[], skipped: Skipped[]): Draft[] {
  const groups = new Map<Node, Map<string, Draft[]>>();
  for (const d of drafts) {
    if (d.radioName === undefined || !d.radioOwner) continue;
    let byName = groups.get(d.radioOwner);
    if (!byName) groups.set(d.radioOwner, (byName = new Map()));
    const list = byName.get(d.radioName) ?? [];
    list.push(d);
    byName.set(d.radioName, list);
  }
  const removed = new Set<Draft>();
  for (const byName of groups.values()) {
    for (const [name, list] of byName) {
      if (list.length < 2) continue;
      const checked = list.find((d) => (d.element as HTMLInputElement).checked);
      const keep = checked ?? list[0];
      keep.kind = 'radio-group';
      keep.reasons.push(
        `Radio group "${name}": the whole group is a single Tab stop (` +
          (checked ? 'the checked option' : 'nothing is checked, so the first option') +
          '). Arrow keys move between the options.',
      );
      for (const d of list) {
        if (d === keep) continue;
        removed.add(d);
        skipped.push({
          element: d.element,
          label: labelOf(d.element),
          reason: `other option in radio group "${name}": Tab stops once per group; use the arrow keys to reach it`,
        });
      }
    }
  }
  return drafts.filter((d) => !removed.has(d));
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

function isNativelyFocusable(el: Element): boolean {
  switch (el.localName) {
    case 'a':
    case 'area':
      return el.hasAttribute('href');
    case 'button':
    case 'select':
    case 'textarea':
    case 'iframe':
      return true;
    case 'input':
      return (el as HTMLInputElement).type !== 'hidden';
    case 'audio':
    case 'video':
      return el.hasAttribute('controls');
    case 'summary': {
      const p = el.parentElement;
      return !!p && p.localName === 'details' && Array.from(p.children).find((c) => c.localName === 'summary') === el;
    }
  }
  if (el instanceof HTMLElement) {
    const ce = el.getAttribute('contenteditable');
    return ce !== null && ce.toLowerCase() !== 'false';
  }
  return false;
}

/** The tabindex the browser uses, or null if the element is not focusable at all. */
function effectiveTabindex(el: Element): number | null {
  const raw = el.getAttribute('tabindex');
  // An invalid tabindex value is ignored, as if the attribute were absent.
  if (raw !== null && /^\s*[+-]?\d+\s*$/.test(raw)) return parseInt(raw, 10);
  return isNativelyFocusable(el) ? 0 : null;
}

function notTabbable(el: Element, cs: CSSStyleDeclaration, tab: number, ctx: Ctx): string | null {
  if (tab < 0) return `tabindex="${tab}": it can be focused by script or a click, but Tab skips it`;
  if (ctx.inert) return 'inside an inert region (the inert attribute, or outside an open modal dialog)';
  if (el.matches(':disabled')) return 'disabled';
  if (SAFARI_DEFAULT && safariSkips(el)) return SAFARI_REASON;
  if (ctx.closedDetails) return 'inside a closed <details>; it becomes reachable when the details is opened';
  if (cs.visibility === 'hidden' || cs.visibility === 'collapse') return 'visibility: hidden';
  if (cs.display === 'contents') return 'display: contents gives it no box, so browsers may skip it';
  if (typeof el.checkVisibility === 'function' && !el.checkVisibility()) return 'not rendered';
  return null;
}

function isScrollContainer(el: Element, cs: CSSStyleDeclaration): boolean {
  if (el === document.body || el === document.documentElement) return false;
  const scrolls = (v: string) => v === 'auto' || v === 'scroll';
  return (
    (scrolls(cs.overflowY) && el.scrollHeight > el.clientHeight) ||
    (scrolls(cs.overflowX) && el.scrollWidth > el.clientWidth)
  );
}

function makeDraft(el: Element, tab: number, ctx: Ctx): Draft {
  const reasons: string[] = [];
  if (tab > 0) {
    reasons.push(
      `tabindex="${tab}": positive values are visited first, lowest number first, ahead of every element ` +
        `with tabindex 0 or no tabindex${ctx.scope ? ' in the same scope' : ' on the page'}.`,
    );
  } else if (isNativelyFocusable(el)) {
    reasons.push(`A <${el.localName}> is focusable by default, so it is visited in source (DOM) order.`);
  } else {
    reasons.push(`tabindex="0" makes this <${el.localName}> focusable. It is visited in source (DOM) order.`);
  }
  reasons.push(...scopeReason(ctx));
  const d: Draft = { element: el, tabindex: tab, kind: 'element', reasons };
  if (el.localName === 'iframe') {
    d.kind = 'iframe';
    reasons.push('Tab moves into the frame and through its contents. This tool does not look inside frames yet.');
  }
  if (el instanceof HTMLInputElement && el.type === 'radio' && el.name) {
    d.radioName = el.name;
    d.radioOwner = el.form ?? el.getRootNode();
  }
  return d;
}

function scopeReason(ctx: Ctx): string[] {
  return ctx.scope
    ? [
        `It lives in ${ctx.scope}. The browser orders elements inside that scope first, ` +
          'then inserts the whole group into the page order where its owner sits.',
      ]
    : [];
}

function toStop(d: Draft, index: number): Stop {
  const hidden = invisibility(d.element);
  const reasons = [...d.reasons];
  const label = d.kind === 'scroller' ? `Scrollable area: ${clip(labelOf(d.element), 40)}` : labelOf(d.element);
  if (hidden) {
    reasons.push(
      `Focusable but not visible: ${hidden}. A keyboard user lands here and sees nothing.` +
        (/skip/i.test(label) ? ' If this is a skip link that appears on focus, that is fine.' : ''),
    );
  }
  return { index, element: d.element, label, tabindex: d.tabindex, kind: d.kind, hidden, reasons };
}

/** Why a focusable element would not be seen, or null. Checked in its unfocused state. */
export function invisibility(el: Element): string | null {
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return 'it has zero size';
  if (r.right + window.scrollX <= 0 || r.bottom + window.scrollY <= 0) return 'it is positioned off-screen';
  if (r.width <= 1 && r.height <= 1) return 'it is 1px or smaller (visually hidden)';
  for (let n: Element | null = el; n; n = composedParent(n)) {
    if (parseFloat(getComputedStyle(n).opacity) === 0) {
      return n === el ? 'it has opacity: 0' : `an ancestor (${describe(n)}) has opacity: 0`;
    }
  }
  const cs = getComputedStyle(el);
  if (cs.clip === 'rect(0px, 0px, 0px, 0px)' || cs.clipPath === 'inset(50%)') return 'it is clipped to nothing';
  return null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FOCUSABLE_SELECTOR =
  'a[href],area[href],button,input:not([type=hidden]),select,textarea,iframe,summary,[tabindex],[contenteditable]';

function recordSubtree(el: Element, reason: string, skipped: Skipped[]): void {
  const found = [el, ...Array.from(el.querySelectorAll(FOCUSABLE_SELECTOR))]
    .filter((e) => effectiveTabindex(e) !== null)
    .slice(0, MAX_SKIPPED_PER_SUBTREE);
  for (const e of found) skipped.push({ element: e, label: labelOf(e), reason });
}

function findModal(): Element | null {
  try {
    return document.querySelector('dialog:modal');
  } catch {
    return null;
  }
}

function safeMatches(el: Element, selector: string): boolean {
  try {
    return el.matches(selector);
  } catch {
    return false;
  }
}

export function composedParent(n: Element): Element | null {
  if (n.parentElement) return n.parentElement;
  const root = n.getRootNode();
  return root instanceof ShadowRoot ? root.host : null;
}

export function describe(el: Element): string {
  const id = el.id ? `#${el.id}` : '';
  return `<${el.localName}${id}>`;
}

function clip(s: string, n = 60): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function squash(s: string | null | undefined): string {
  return (s ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * The element's accessible name (W3C accname rules, via dom-accessibility-api), falling
 * back to visible text, alt, title or placeholder so every stop has a usable label.
 */
export function labelOf(el: Element): string {
  try {
    const name = squash(computeAccessibleName(el));
    if (name) return clip(name);
  } catch {
    // fall back to the heuristic below
  }
  const aria = squash(el.getAttribute('aria-label'));
  if (aria) return clip(aria);
  const ids = el.getAttribute('aria-labelledby');
  if (ids) {
    const root = el.getRootNode() as Document | ShadowRoot;
    const t = squash(ids.split(/\s+/).map((id) => root.getElementById(id)?.textContent ?? '').join(' '));
    if (t) return clip(t);
  }
  const labels = (el as HTMLInputElement).labels;
  if (labels && labels.length) {
    const t = squash(labels[0].textContent);
    if (t) return clip(t);
  }
  if (el instanceof HTMLInputElement && ['submit', 'button', 'reset'].includes(el.type) && el.value) {
    return clip(el.value);
  }
  const text = squash(el.textContent);
  if (text) return clip(text);
  const alt = squash(el.querySelector('img[alt]')?.getAttribute('alt'));
  if (alt) return clip(alt);
  const fallback = squash(el.getAttribute('title')) || squash(el.getAttribute('placeholder'));
  return fallback ? clip(fallback) : `<${el.localName}>`;
}
