# Changelog

## 1.1.0 (2026-11-21)

**Busy pages**
- Region view: one labelled box per landmark (solid), inferred group (dashed) or stops outside any landmark (dotted), with arrows for the order Tab moves between them. The default above 150 stops; switch with Detail: Regions / Every stop.
- Landmarks with very many stops are split into inferred groups (lists, toolbars, named containers).
- Expand one region from its box or from the new Regions list in the panel (the keyboard route).
- "Long jumps only" hides short hops but keeps every backward jump.
- Overlapping badges merge into one range badge, such as "220–224 (5)".

**Checks**
- Many Tab stops outside any landmark; an area Tab enters three or more separate times (returns from nested landmarks do not count).
- Landmarks of the same kind with the same name, or none (our own check: axe-core's `landmark-unique` rule crashes Firefox's page process when run with the overlay open).
- axe-core rules `region` and `landmark-one-main` (full build and extension).

**Bookmarklets**
- Two versions: standard (Chrome, Edge, Safari) and Firefox, which leaves out the Region view to stay under Firefox's bookmark size limit. The install page offers the right one for the browser, with a switch.
- The build strips the config file's explanatory comments from the bundles.
- New demo page: `demo/busy.html`.

## 1.0.0 (2026-11-20)

First public release. Site: https://voiceofgrog.github.io/tab-order-visualizer/

**Shows**
- The real Tab order as numbered badges and shaded, curved arrows, with the reason for each stop's position (positive `tabindex`, Shadow DOM and slot scopes, radio groups, scroll boxes).
- A suggested order based on the visual layout: square badges and dashed arrows. Backward jumps are marked "back".
- Focusable elements that Tab skips, and why (disabled, inert, `tabindex="-1"`, closed `<details>`, hidden).

**Checks** (each with severity, a plain-language fix and WCAG links)
- Own checks: focusable but invisible; focus hidden under sticky or fixed content (entirely: 2.4.11, partly: 2.4.12); keyboard traps and scripts that take over Tab; script-managed modal dialogs such as cookie banners; backward jumps with their likely cause; multiple H1s; no skip link.
- axe-core rules (full build and extension): `tabindex`, `heading-order`, `page-has-heading-one`, `empty-heading`, `bypass`, `scrollable-region-focusable`, `frame-focusable-content`.

**Time model**
- Estimated time to reach any stop, and to Tab through the whole page, for three adjustable profiles (sighted keyboard user; everyday and expert screen reader users). Shows what a skip link or the suggested order would save. Clearly labelled as a model.

**Browsers**
- Applies each engine's Tab rules. Default Safari only tabs to text fields, pop-up menus and `<details>` summaries (plus anything with `tabindex`), and never to scroll boxes; skipped items are listed with the reason. `safari.tabToAll` covers people who turned on "Press Tab to highlight each item".
- Automated tests compare the tool with real Tab presses on every push: Chromium and Firefox on Linux, WebKit on macOS.

**Delivery**
- Bookmarklet (about 59,000 characters, under Firefox's 65,536-character bookmark limit), an install page with a copy-code fallback, an unpacked browser extension with the full checks, and demo pages.
- Panel: keyboard operable (Alt+Shift+T, Escape), light and dark themes, colour presets, three sizes, minimise, step-through, version shown with a link to check for updates.

**Privacy**
- Runs entirely in the browser: no network requests, no analytics, nothing stored.
