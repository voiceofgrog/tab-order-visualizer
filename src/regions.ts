/**
 * Region view: groups Tab stops into page regions so busy pages become a handful of boxes.
 *
 *  1. Each stop belongs to its innermost landmark (banner, navigation, main, complementary,
 *     contentinfo, search, a named form, a named region).
 *  2. A landmark with very many stops is split into inferred groups: the innermost list,
 *     table, fieldset, toolbar, menu or named container holding at least a few stops.
 *  3. Stops in no landmark are grouped the same way, or counted as "outside any landmark".
 *
 * Inferred groups are a convenience for reading, not landmarks: they are labelled as such.
 */
import config from '../config/defaults.json';
import { composedParent, describe, type Stop } from './order';

export type RegionKind = 'landmark' | 'inferred' | 'outside';

export interface Region {
  id: number;
  element: Element | null;
  kind: RegionKind;
  /** Landmark role, or a description such as "list" for inferred groups. */
  role: string;
  /** Accessible name if it has one, else a readable fallback. */
  name: string;
  /** True if the name came from aria-label/aria-labelledby (or a heading, for inferred groups). */
  named: boolean;
  stops: Stop[];
  /** How many separate times Tab enters this region. */
  entries: number;
}

export interface RegionMap {
  regions: Region[];
  /** Runs of consecutive stops in one region, in Tab order. */
  segments: { region: Region; first: Stop; last: Stop; count: number }[];
  outside: number;
}

const GROUP_SELECTOR =
  'ul,ol,table,fieldset,section,article,form,[role=list],[role=listbox],[role=grid],[role=tree],[role=treegrid],' +
  '[role=toolbar],[role=menu],[role=menubar],[role=tablist],[role=group],[role=feed],[role=log],[aria-label],[aria-labelledby]';

/** The landmark role an element exposes, or null. Implicit roles follow HTML-AAM. */
export function landmarkRole(el: Element): string | null {
  const explicit = el.getAttribute('role')?.trim().split(/\s+/)[0];
  const landmarks = ['banner', 'navigation', 'main', 'complementary', 'contentinfo', 'search', 'form', 'region'];
  if (explicit) return landmarks.includes(explicit) && (!['form', 'region'].includes(explicit) || hasName(el)) ? explicit : null;
  switch (el.localName) {
    case 'main': return 'main';
    case 'nav': return 'navigation';
    case 'aside': return 'complementary';
    case 'search': return 'search';
    case 'header': return scopedToBody(el) ? 'banner' : null;
    case 'footer': return scopedToBody(el) ? 'contentinfo' : null;
    case 'form': return hasName(el) ? 'form' : null;
    case 'section': return hasName(el) ? 'region' : null;
  }
  return null;
}

/** header/footer are page landmarks only when not inside article, aside, main, nav or section. */
function scopedToBody(el: Element): boolean {
  for (let n = composedParent(el); n; n = composedParent(n)) {
    if (n.matches('article,aside,main,nav,section,[role=article],[role=complementary],[role=main],[role=navigation],[role=region]')) return false;
  }
  return true;
}

function hasName(el: Element): boolean {
  return !!nameFrom(el);
}

function nameFrom(el: Element): string {
  const label = el.getAttribute('aria-label')?.trim();
  if (label) return label;
  const ids = el.getAttribute('aria-labelledby');
  if (ids) {
    const root = el.getRootNode() as Document | ShadowRoot;
    const text = ids.split(/\s+/).map((id) => root.getElementById(id)?.textContent ?? '').join(' ').replace(/\s+/g, ' ').trim();
    if (text) return text;
  }
  return '';
}

const ROLE_LABEL: Record<string, string> = {
  banner: 'Banner', navigation: 'Navigation', main: 'Main', complementary: 'Complementary', contentinfo: 'Footer',
  search: 'Search', form: 'Form', region: 'Region',
};

function contains(ancestor: Element, node: Element): boolean {
  for (let n: Element | null = node; n; n = composedParent(n)) if (n === ancestor) return true;
  return false;
}

function clip(s: string, n = 40): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

/** Name for an inferred group: its label, else its first heading, legend or caption. */
function groupName(el: Element): { name: string; named: boolean } {
  const label = nameFrom(el);
  if (label) return { name: label, named: true };
  const heading = el.querySelector('h1,h2,h3,h4,h5,h6,legend,caption,[role=heading]')?.textContent?.replace(/\s+/g, ' ').trim();
  if (heading) return { name: heading, named: true };
  const role = el.getAttribute('role') || el.localName;
  return { name: `Unnamed ${role === 'ul' || role === 'ol' ? 'list' : role} ${describe(el)}`, named: false };
}

export function computeRegions(stops: Stop[]): RegionMap {
  const { maxStopsPerRegion, minGroupStops } = config.regions;

  // For every stop: its innermost landmark, and the group-like containers between them.
  const info = stops.map((s) => {
    const chain: Element[] = [];
    let landmark: Element | null = null;
    for (let n = composedParent(s.element); n && n !== document.body && n !== document.documentElement; n = composedParent(n)) {
      if (landmarkRole(n)) {
        landmark = n;
        break;
      }
      if (n.matches(GROUP_SELECTOR)) chain.push(n);
    }
    return { s, landmark, chain };
  });

  const count = new Map<Element | null, number>();
  for (const { landmark, chain } of info) {
    count.set(landmark, (count.get(landmark) ?? 0) + 1);
    for (const c of chain) count.set(c, (count.get(c) ?? 0) + 1);
  }

  const regions = new Map<Element | string, Region>();
  const regionOf = (key: Element | string, make: () => Omit<Region, 'id' | 'stops' | 'entries'>): Region => {
    let r = regions.get(key);
    if (!r) regions.set(key, (r = { ...make(), id: regions.size + 1, stops: [], entries: 0 }));
    return r;
  };

  const assigned = info.map(({ s, landmark, chain }) => {
    const big = landmark === null || (count.get(landmark) ?? 0) > maxStopsPerRegion;
    const group = big ? chain.find((c) => (count.get(c) ?? 0) >= minGroupStops) : undefined;
    let region: Region;
    if (group) {
      const g = groupName(group);
      const within = landmark ? `${nameFrom(landmark) || ROLE_LABEL[landmarkRole(landmark)!]} › ` : '';
      region = regionOf(group, () => ({ element: group, kind: 'inferred', role: group.getAttribute('role') || group.localName, name: clip(within + g.name, 60), named: g.named }));
    } else if (landmark) {
      const role = landmarkRole(landmark)!;
      const name = nameFrom(landmark);
      region = regionOf(landmark, () => ({ element: landmark, kind: 'landmark', role, name: clip(name || ROLE_LABEL[role]), named: !!name }));
    } else {
      region = regionOf('outside', () => ({ element: null, kind: 'outside', role: '', name: 'Outside any landmark', named: false }));
    }
    region.stops.push(s);
    return region;
  });

  const segments: RegionMap['segments'] = [];
  const lastSegment = new Map<Region, number>();
  assigned.forEach((region, i) => {
    const last = segments[segments.length - 1];
    if (last && last.region === region) {
      last.last = stops[i];
      last.count++;
      return;
    }
    segments.push({ region, first: stops[i], last: stops[i], count: 1 });
    // Coming back after visiting only regions nested inside this one (a <main> containing a
    // named <section>, say) is normal structure, not a fragmented order: it does not count.
    const prev = lastSegment.get(region);
    const onlyNested =
      prev !== undefined &&
      !!region.element &&
      segments.slice(prev + 1, -1).every((g) => !!g.region.element && contains(region.element!, g.region.element));
    if (!onlyNested) region.entries++;
    lastSegment.set(region, segments.length - 1);
  });

  const list = [...regions.values()].sort((a, b) => a.stops[0].index - b.stops[0].index);
  return { regions: list, segments, outside: regions.get('outside')?.stops.length ?? 0 };
}
