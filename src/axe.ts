/**
 * Runs a chosen set of axe-core rules and rewrites the results in plain language
 * (config/rules.json). axe is only present in the full build; the bookmarklet build
 * leaves it out to stay small.
 */
import config from '../config/defaults.json';
import rules from '../config/rules.json';
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
  const res = await axe.run(
    { exclude: [[OVERLAY_TAG]] },
    { runOnly: { type: 'rule', values: config.axeRules }, resultTypes: ['violations', 'incomplete'] },
  );
  const out: Issue[] = [];
  const add = (r: AxeRuleResult, kind: 'violation' | 'incomplete') => {
    const t = RULES[r.id];
    const elements = r.nodes.map((n) => resolve(n.target)).filter((e): e is Element => !!e);
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
