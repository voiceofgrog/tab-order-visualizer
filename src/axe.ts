/**
 * Runs a chosen set of axe-core rules and rewrites the results in plain language
 * (config/rules.json). axe is only present in the full build; the bookmarklet build
 * leaves it out to stay small.
 */
import config from '../config/defaults.json';
import rules from '../config/rules.json';
import { isSkipLink } from './checks';
import { OVERLAY_TAG, labelOf } from './order';
import type { Issue, Severity } from './types';

interface AxeNode {
  target: unknown[];
}
interface AxeRuleResult {
  id: string;
  help: string;
  helpUrl: string;
  nodes: AxeNode[];
}
interface AxeResults {
  violations: AxeRuleResult[];
  incomplete: AxeRuleResult[];
}
export interface AxeLike {
  run(context: unknown, options: unknown): Promise<AxeResults>;
}
interface RuleText {
  severity: Severity;
  title: string;
  why: string;
  fix: string;
  note?: string;
  wcag: string[];
}

const RULES = rules as unknown as Record<string, RuleText>;


export async function runAxe(axe: AxeLike): Promise<Issue[]> {
  // Our panel is a landmark (role="region"). Landmark rules such as landmark-unique gather every
  // landmark on the page, including excluded ones, so they would judge our panel too. Worse, in
  // Firefox that crashes the page's process (seen in CI). For the length of the run only, the
  // panel stops being a landmark; its role is restored straight after.
  const panel = document.querySelector(OVERLAY_TAG)?.shadowRoot?.querySelector('[role=region]') ?? null;
  panel?.removeAttribute('role');
  let res: AxeResults;
  try {
    res = await axe.run(
      { exclude: [[OVERLAY_TAG]] },
      { runOnly: { type: 'rule', values: config.axeRules }, resultTypes: ['violations', 'incomplete'] },
    );
  } finally {
    panel?.setAttribute('role', 'region');
  }
  const out: Issue[] = [];
  const add = (r: AxeRuleResult, kind: 'violation' | 'incomplete') => {
    const t = RULES[r.id];
    let elements = r.nodes.map((n) => resolve(n.target)).filter((e): e is Element => !!e);
    // axe exempts skip links from "region" only if they come before the first ordinary link it
    // finds. Our open panel contains ordinary links inside Shadow DOM, where "before" cannot be
    // decided, so axe then flags real skip links. Drop exactly those.
    if (r.id === 'region') elements = elements.filter((e) => !isSkipLink(e));
    if (!elements.length && r.nodes.length) return;
    out.push({
      id: `axe-${r.id}-${kind}`,
      rule: r.id,
      source: 'axe',
      severity: kind === 'incomplete' ? 'review' : (t?.severity ?? 'review'),
      title: t?.title ?? r.help,
      summary: (kind === 'incomplete' ? 'axe-core could not decide automatically, so a person should check. ' : '') + (t?.why ?? r.help),
      fix: t?.fix ?? 'See the rule details.',
      note: t?.note,
      wcag: t?.wcag ?? [],
      elements,
      labels: elements.map(labelOf),
      moreInfo: r.helpUrl,
    });
  };
  for (const r of res.violations) add(r, 'violation');
  for (const r of res.incomplete) add(r, 'incomplete');
  return out;
}

/** axe targets are CSS selectors; an inner array is a path through shadow roots. */
function resolve(target: unknown[]): Element | null {
  const first = target[0];
  try {
    if (typeof first === 'string') return document.querySelector(first);
    if (Array.isArray(first)) {
      let root: Document | ShadowRoot | null = document;
      let el: Element | null = null;
      for (const sel of first) {
        if (!root) return null;
        el = root.querySelector(String(sel));
        root = el?.shadowRoot ?? null;
      }
      return el;
    }
  } catch {
    // invalid selector: fall through
  }
  return null;
}
