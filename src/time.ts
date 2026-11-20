/**
 * Time model: an estimate of how long it takes to Tab to an element, not a measurement.
 *
 *   cost of one stop = secondsPerTab
 *                    + words heard / wordsPerMinute * 60     (screen reader profiles)
 *                    + visualSecondsPerStop                  (sighted profile)
 *   time to reach stop k = sum of the costs of stops 1..k
 *
 * Words heard = the accessible name plus the role a screen reader adds ("link",
 * "radio button") and simple state ("checked", "2 of 3"), capped at maxWordsHeard for
 * experts who cut speech off. All numbers live in config/defaults.json (timing).
 */
import { getRole } from 'dom-accessibility-api';
import config from '../config/defaults.json';
import { isSkipLink, contains } from './checks';
import type { Stop } from './order';
import type { ScanResult } from './types';

export interface Profile {
  id: string;
  label: string;
  secondsPerTab: number;
  wordsPerMinute: number | null;
  maxWordsHeard: number | null;
  visualSecondsPerStop: number;
  basis: string;
}

export interface Announcement {
  text: string;
  words: number;
}

export interface Estimate {
  profileId: string;
  profileLabel: string;
  /** Seconds to reach the target from the top of the page, in the real order. */
  reach: number;
  reachStops: number;
  /** Seconds to Tab through every stop. */
  total: number;
  /** Same target in the suggested order (null if the target is not in it, e.g. invisible). */
  suggestedReach: number | null;
  suggestedStops: number | null;
}

export interface SkipEstimate {
  hasSkipLink: boolean;
  /** Tab presses to reach the first item in <main> without using a skip link. */
  stopsWithout: number;
  /** Key presses (Tab and Enter) to reach it with a skip link. */
  pressesWith: number;
  target: string;
  perProfile: { profileId: string; profileLabel: string; without: number; with: number }[];
}

export const PROFILES = config.timing.profiles as Profile[];
const ROLE_SPEECH = config.timing.roleSpeech as Record<string, string>;
const SKIP_LINK_ANNOUNCEMENT: Announcement = { text: 'Skip to main content, link', words: 5 };

/** Roughly what a screen reader says when the stop receives focus. */
export function announce(s: Stop): Announcement {
  const el = s.element;
  let role = '';
  try {
    role = getRole(el) ?? '';
  } catch {
    role = '';
  }
  // A scroll box with no name or role is announced (at most) as a scrollable region.
  const parts =
    s.kind === 'scroller' && !role
      ? [s.element.getAttribute('aria-label') ?? '', 'scrollable region']
      : [s.label.startsWith('<') ? '' : s.label, role.startsWith('_') ? '' : (ROLE_SPEECH[role] ?? role)];
  if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) {
    parts.push(el.checked ? 'checked' : 'not checked');
  }
  if (s.kind === 'radio-group' && el instanceof HTMLInputElement) {
    const scope = el.form ?? (el.getRootNode() as Document | ShadowRoot);
    const group = Array.from(scope.querySelectorAll('input[type=radio]')).filter((r) => (r as HTMLInputElement).name === el.name);
    parts.push(`${group.indexOf(el) + 1} of ${group.length}`);
  }
  if (el.localName === 'summary') parts.push((el.parentElement as HTMLDetailsElement | null)?.open ? 'expanded' : 'collapsed');
  const text = parts.filter(Boolean).join(', ');
  return { text, words: text.split(/[\s,]+/).filter(Boolean).length };
}

export function stopCost(a: Announcement, p: Profile): number {
  const heard = p.maxWordsHeard ? Math.min(a.words, p.maxWordsHeard) : a.words;
  const listen = p.wordsPerMinute ? (heard / p.wordsPerMinute) * 60 : 0;
  return p.secondsPerTab + listen + p.visualSecondsPerStop;
}

function sum(anns: Announcement[], p: Profile, upTo = anns.length): number {
  let t = 0;
  for (let i = 0; i < upTo; i++) t += stopCost(anns[i], p);
  return t;
}

export function estimate(r: ScanResult, target: Stop): Estimate[] {
  const real = r.order.stops.map((s) => r.announcements.get(s)!);
  const sugg = r.suggested.map((s) => r.announcements.get(s)!);
  const k = r.order.stops.indexOf(target);
  const ks = r.suggested.indexOf(target);
  return PROFILES.map((p) => ({
    profileId: p.id,
    profileLabel: p.label,
    reach: sum(real, p, k + 1),
    reachStops: k + 1,
    total: sum(real, p),
    suggestedReach: ks >= 0 ? sum(sugg, p, ks + 1) : null,
    suggestedStops: ks >= 0 ? ks + 1 : null,
  }));
}

/**
 * What a skip link saves (or would save) in reaching the first Tab stop inside <main>.
 * With a skip link: Tab to it, Enter, then Tab once more to the first item in main.
 */
export function skipLinkEstimate(r: ScanResult): SkipEstimate | null {
  const main = document.querySelector('main, [role=main]');
  const stops = r.order.stops;
  if (!main) return null;
  const idx = stops.findIndex((s) => contains(main, s.element));
  if (idx < 1) return null;
  const anns = stops.map((s) => r.announcements.get(s)!);
  const skipAt = stops.slice(0, 2).findIndex((s) => isSkipLink(s.element));
  const hasSkipLink = skipAt >= 0;
  return {
    hasSkipLink,
    stopsWithout: idx + 1,
    pressesWith: (hasSkipLink ? skipAt + 1 : 1) + 2,
    target: stops[idx].label,
    perProfile: PROFILES.map((p) => {
      const toSkip = hasSkipLink ? sum(anns, p, skipAt + 1) : stopCost(SKIP_LINK_ANNOUNCEMENT, p);
      return {
        profileId: p.id,
        profileLabel: p.label,
        without: sum(anns, p, idx + 1),
        with: toSkip + p.secondsPerTab + stopCost(anns[idx], p),
      };
    }),
  };
}

export function formatSeconds(s: number): string {
  if (s < 60) return `${s.toFixed(1)} s`;
  const m = Math.floor(s / 60);
  return `${m} min ${Math.round(s - m * 60)} s`;
}
