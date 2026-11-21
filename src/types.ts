import type { OrderResult, Stop } from './order';
import type { Announcement } from './time';
import type { RegionMap } from './regions';

/** fail = very likely a WCAG failure; review = a person should check; advice = best practice. */
export type Severity = 'fail' | 'review' | 'advice';

export interface Issue {
  id: string;
  rule: string;
  source: 'axe' | 'tool';
  severity: Severity;
  title: string;
  /** What is wrong and why it matters, in plain language. */
  summary: string;
  /** What an editor or developer can do about it. */
  fix: string;
  note?: string;
  /** WCAG success criterion numbers, e.g. "2.4.3". Keys of config/wcag.json. */
  wcag: string[];
  elements: Element[];
  labels: string[];
  moreInfo?: string;
}

export interface ScanResult {
  order: OrderResult;
  /** Visible stops in visual reading order (a heuristic). */
  suggested: Stop[];
  issues: Issue[];
  /** Real-order indices i where the step from stop i to stop i+1 jumps backwards visually. */
  jumps: Set<number>;
  /** Roughly what a screen reader announces for each stop (input to the time model). */
  announcements: Map<Stop, Announcement>;
  /** Stops grouped by landmark (or inferred group), for the Region view. */
  regions: RegionMap;
  axe: 'ran' | 'not-included' | 'error';
  axeMessage?: string;
}
