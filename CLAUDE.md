# CLAUDE.md: Tab-Order Visualizer

A small, free, client-side tool that overlays a page's real keyboard tab order (numbered badges + arrows), flags accessibility problems in that order, shows a suggested better order, and estimates keyboard / screen reader time-to-reach. It should teach how browsers decide focus order and be usable by editors and developers who are not accessibility specialists.

## How to work with the owner
- Explain what each step does and why, not only what.
- Work in stages. Stop for review at the end of each stage with: what passed, what failed, anything surprising.
- Say plainly when something is a guess. Separate verified facts from inferences.
- Prefer safe, reversible actions. Ask before anything outward-facing: publishing, pushing, creating accounts or repos, adding dependencies with unusual licenses.
- Target about 2-3 hours total. Keep scope tight; stretch goals are listed separately and done only on request.

## Environment
- Native Windows, PowerShell, non-admin. Use PowerShell syntax. If `npm.ps1` is blocked, use `npm.cmd` / `npx.cmd`.
- npm scripts must be cross-platform: no bash-isms (no `rm -rf`, `&&` chains that assume sh, `export VAR=`).
- TypeScript, bundled to a single self-contained file (esbuild).
- Never modify global settings, install global packages, or run anything as administrator.

## Git rules
- Repo: `tab-order-visualizer`, default branch `main`.
- Use the repo-local git identity only, never the global one. Check with `git config --show-origin --get-regexp "^user\."`; if no local identity is set, ask.
- Small, meaningful commits at the end of each stage, with clear messages.
- Never commit secrets, credentials, or real internal hostnames. Use `https://example.edu` as the placeholder.
- If a GitHub repo is created it must be PRIVATE first; verify visibility after creating. Push `main` only, never force. The owner decides if/when it goes public.

## Code rules
- Locate things the way a user perceives them: roles and visible text first.
- Playwright: web-first assertions and auto-waiting. Never `waitForTimeout`, sleeps, extra retries, or loosened assertions to fix timing.
- A failing test is information: say whether it looks like a tool bug or a test-data bug, and why.
- Configurable values (timing assumptions, ignored selectors) live in a data/config file, not in logic.
- Everything runs locally in the browser. No network calls, no analytics, no data leaves the page.
- The overlay must not change the host page's layout or tab order; isolate it in Shadow DOM.
- Suggested order and heuristic checks are labelled "suggested", with reasoning per issue. Time estimates are labelled as a model, not a measurement.

## Testing on real sites
- Read-only. Never submit forms. Only test sites the owner has named.

## Stages
0. Research (report, then stop)
1. Core visualizer + demo page + Playwright accuracy tests
2. Issues (axe-core + own checks) and suggested order
3. Time model
4. Validation, tool accessibility, README

Stretch (only after Stage 4, only on request): ghost walker animation, tabs-to-reach heatmap, before/after scan compare, JSON export / PNG snapshot.
