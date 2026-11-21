/**
 * Region view drawing and panel controls. Kept in its own module of plain functions so the
 * Firefox bookmarklet build (__LITE__) can leave it out entirely: Firefox stores bookmarks of
 * at most about 65,536 characters, and the full tool no longer fits.
 */
import type { Region, RegionMap } from './regions';

type Pt = readonly [number, number];


export const REGION_CSS = `
.region { fill: var(--real); fill-opacity: .05; stroke: var(--real); stroke-width: 2px; }
.region.inferred { stroke-dasharray: 8 5; }
.region.outside { stroke-dasharray: 2 4; }
.region-halo { fill: none; stroke: var(--halo); stroke-width: 5px; }
.real.rflow { stroke-width: calc(var(--stroke) * 1.8); }
.rlabel { position: absolute; max-width: 360px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; pointer-events: auto; cursor: pointer;
  box-sizing: border-box; padding: 2px 8px; border-radius: 6px; border: 2px solid var(--halo); background: var(--real); color: var(--real-text);
  font: 600 12px/16px system-ui, -apple-system, 'Segoe UI', sans-serif; box-shadow: 0 1px 2px rgba(0,0,0,.3), 0 3px 8px rgba(0,0,0,.18); }
.rlabel.inferred, .rlabel.outside { background: var(--halo); color: var(--real); border: 2px dashed var(--real); }
.rlabel:hover { filter: brightness(1.15); }
.regions li { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 6px; }
.regions button[aria-pressed=true] { background: var(--ui-accent); border-color: var(--ui-accent); color: var(--ui-accent-fg); }
`;

export interface RegionUi {
  detailSet: HTMLFieldSetElement;
  radios: HTMLInputElement[];
  section: HTMLDetailsElement;
  title: HTMLElement;
  list: HTMLUListElement;
  showAll: HTMLButtonElement;
}

/** Helpers the overlay already has, passed in so this module stays independent. */
export interface Kit {
  el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K];
  button(text: string, onClick: () => void): HTMLButtonElement;
  radio(name: string, value: string, text: string, checked: boolean, onPick: () => void): HTMLLabelElement;
  section(title: string): [HTMLDetailsElement, HTMLElement];
  svgEl(tag: string, attrs: Record<string, string>): SVGElement;
  curve(a: Pt, b: Pt, R: number): { d: string } | null;
  place(b: HTMLElement | undefined, x: number, y: number): void;
}

/** The "Detail" switch (Regions / Every stop) and the panel's Regions section. */
export function buildRegionUi(kit: Kit, detail: string, onDetail: (v: 'regions' | 'stops') => void, onShowAll: () => void): RegionUi {
  const detailSet = kit.el('fieldset', '');
  const legend = kit.el('legend', '');
  legend.textContent = 'Detail';
  const row = kit.el('div', 'seg');
  const radios: HTMLInputElement[] = [];
  for (const [value, text] of [['regions', 'Regions'], ['stops', 'Every stop']] as const) {
    const label = kit.radio('tov-detail', value, text, value === detail, () => onDetail(value));
    radios.push(label.querySelector('input')!);
    row.append(label);
  }
  detailSet.append(legend, row);
  // The list is the keyboard-accessible way to expand a region (the boxes on the page are mouse
  // shortcuts, hidden from assistive technology like the rest of the drawing).
  const [section, title] = kit.section('Regions');
  const list = kit.el('ul', 'regions');
  const showAll = kit.button('Show all regions', onShowAll);
  showAll.hidden = true;
  section.lastElementChild!.append(showAll, list);
  return { detailSet, radios, section, title, list, showAll };
}

export function renderRegionList(kit: Kit, ui: RegionUi, map: RegionMap, expanded: Region | null, onToggle: (g: Region) => void): void {
  ui.title.textContent = `Regions (${map.regions.length})`;
  ui.showAll.hidden = !expanded;
  ui.list.replaceChildren(
    ...map.regions.map((g) => {
      const li = kit.el('li', '');
      const b = kit.button(g.name, () => onToggle(g));
      b.setAttribute('aria-pressed', String(expanded === g));
      const kind = g.kind === 'landmark' ? `${g.role} landmark` : g.kind === 'inferred' ? 'inferred group' : 'no landmark';
      const meta = kit.el('span', 'small');
      meta.textContent =
        ` ${kind} · ${g.stops.length} stop${g.stops.length === 1 ? '' : 's'} · from press ${g.stops[0].index}` +
        (g.entries > 1 ? ` · entered ${g.entries} times` : '');
      li.append(b, meta);
      return li;
    }),
  );
}

/** One clickable label per region, e.g. "Chat · complementary · 85 stops · from press 799". */
export function makeRegionLabels(kit: Kit, box: HTMLElement, map: RegionMap, onClick: (g: Region) => void): HTMLDivElement[] {
  box.replaceChildren();
  return map.regions.map((g) => {
    const label = kit.el('div', `rlabel ${g.kind}`);
    const kind = g.kind === 'landmark' ? g.role : g.kind === 'inferred' ? 'inferred' : 'no landmark';
    label.textContent = `${g.name} · ${kind} · ${g.stops.length} stop${g.stops.length === 1 ? '' : 's'} · from press ${g.stops[0].index}`;
    label.addEventListener('click', () => onClick(g));
    box.append(label);
    return label;
  });
}

/** The landmark's own box, or (for groups without one) the union of its visible stops. */
export function regionRect(g: Region, box: (e: Element) => DOMRect): DOMRect | null {
  if (g.element && g.kind !== 'outside') {
    const r = box(g.element);
    if (r.width >= 1 && r.height >= 1) return r;
  }
  const rs = g.stops.filter((s) => !s.hidden).map((s) => box(s.element)).filter((r) => r.width >= 1 || r.height >= 1);
  if (!rs.length) return null;
  const l = Math.min(...rs.map((r) => r.left)), t = Math.min(...rs.map((r) => r.top));
  return new DOMRect(l - 6, t - 6, Math.max(...rs.map((r) => r.right)) - l + 12, Math.max(...rs.map((r) => r.bottom)) - t + 12);
}

export function drawRegion(kit: Kit, svg: SVGSVGElement, g: Region, r: DOMRect): void {
  const a = { x: String(r.left), y: String(r.top), width: String(r.width), height: String(r.height), rx: '6' };
  svg.append(kit.svgEl('rect', { ...a, class: 'region-halo' }), kit.svgEl('rect', { ...a, class: `region ${g.kind}` }));
}

/** Overview: one box per region and arrows for the order Tab moves between regions. */
export function drawOverview(
  kit: Kit, svg: SVGSVGElement, map: RegionMap, labels: HTMLDivElement[], box: (e: Element) => DOMRect,
  docW: number, docH: number, arrows: boolean,
): void {
  const anchor = new Map<Region, Pt>();
  map.regions.forEach((g, i) => {
    const r = regionRect(g, box);
    const label = labels[i];
    if (!r) return void (label.style.display = 'none');
    label.style.display = '';
    drawRegion(kit, svg, g, r);
    const x = Math.min(Math.max(r.left + 4, 2), docW - 40);
    const y = Math.min(Math.max(r.top + 4, 2), docH - 24);
    kit.place(label, x, y);
    anchor.set(g, [x + 10, y + 10]);
  });
  if (!arrows) return;
  const seen = new Set<string>();
  for (let i = 0; i + 1 < map.segments.length; i++) {
    const from = map.segments[i].region, to = map.segments[i + 1].region;
    const a = anchor.get(from), b = anchor.get(to);
    const key = `${from.id}>${to.id}`;
    if (!a || !b || seen.has(key)) continue;
    seen.add(key);
    const c = kit.curve(a, b, 10);
    if (!c) continue;
    svg.append(
      kit.svgEl('path', { class: 'shadow', d: c.d, transform: 'translate(1.2 1.8)' }),
      kit.svgEl('path', { class: 'halo', d: c.d }),
      kit.svgEl('path', { class: 'real rflow', d: c.d, 'marker-end': 'url(#tov-head-real)' }),
    );
  }
}


