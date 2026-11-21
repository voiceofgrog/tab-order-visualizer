# Background research

Notes behind the tool's design: what already exists, how browsers decide Tab order, and where the time model's numbers come from. Researched November 2026. Where a point was not confirmed by a source or by the tool's own tests, it says so.

## Existing tools

| Tool | What it does | What it does not do |
|---|---|---|
| [taba11y](https://chromewebstore.google.com/detail/taba11y-tab-order-accessi/aocppmckdocdjkphmofnklcjhdidgmga) ([Firefox](https://addons.mozilla.org/addon/taba11y/)) | Draws a path or highlights elements in Tab order. The most established extension of its kind. | No suggested order, WCAG explanations or timing (from its listing) |
| [Tab Order Visualizer](https://chromewebstore.google.com/detail/apnammgabgdjpmcjajbfbmeiejigpjph), [Tab Order Checker](https://chromewebstore.google.com/detail/tab-order-checker/pefibaogdlgickocjjdmmmfabnmmnikd) (Chrome) | Numbered badges in Tab order | No arrows, issues, suggested order or timing (from their listings) |
| [Firefox "Show Tabbing Order"](https://firefox-source-docs.mozilla.org/devtools-user/accessibility_inspector/) | Built-in DevTools overlay of focus order; a static snapshot | No issues, suggestion or timing |
| [Chromium Source Order Viewer](https://adrianroselli.com/2020/09/source-order-viewer-in-edge-86.html) and [Roselli's reading-order bookmarklet](https://adrianroselli.com/2019/04/reading-order-bookmarklet.html) | Show DOM source order for a container, to compare with visual order | Source order, not Tab order |
| [Accessibility Insights Tab Stops](https://accessibilityinsights.io/docs/web/getstarted/assessment/) | Numbers stops as you press Tab yourself; flags some possible issues for review | Computes nothing ahead of time |
| [Deque Keyboard IGT](https://docs.deque.com/devtools-for-web/4/en/devtools-igt-keyboard) | Guided keyboard test with automated checks (commercial) | Not free; no time model |
| [Tactual](https://raw.githubusercontent.com/tactual-dev/tactual/HEAD/README.md) (npm) | Scores how hard screen reader users find it to reach targets, from Playwright accessibility snapshots | A command-line score, not an in-page overlay; no seconds |

Also seen: [FocusFlow Inspector](https://addons.mozilla.org/addon/focusflow-inspector/), [Focus Order Validator](https://addons.mozilla.org/en-US/firefox/addon/focus-order-validator), [A11yFocus](https://addons.mozilla.org/en-CA/firefox/addon/a11yfocus) and the [Storybook keyboard-nav visualizer](https://storybook.js.org/addons/storybook-addon-keyboard-nav-visualizer).

As far as these listings show, none draws a suggested order beside the real one or estimates time to reach in seconds. That gap is what this tool fills. (Based on store listings and documentation, not on installing each tool.)

## Bookmarklets and Content Security Policy

- The CSP specification says a page's policy should not interfere with bookmarklets and extensions, but browsers have varied over time ([Firefox bug 866522](https://bugzilla.mozilla.org/show_bug.cgi?id=866522), [W3C discussion](https://lists.w3.org/Archives/Public/public-webappsec/2014Jul/0063.html)).
- What a strict policy reliably blocks is what a bookmarklet *loads or creates*: scripts from other hosts, `eval`, inline `<style>` under a strict `style-src`, and `innerHTML` under Trusted Types. The tool avoids all of these, and a test confirms it draws and styles itself on a page with `default-src 'none'` and Trusted Types required. Whether a browser lets a clicked bookmarklet *start* on a strict page is browser-specific.
- Extensions inject code as privileged scripts that page CSP generally does not block ([activeTab](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab)). Hence two builds: a small bookmarklet, and an extension with the full checks.
- Firefox truncates bookmark URLs longer than about 65,536 characters without warning ([bug 865108](https://bugzilla.mozilla.org/show_bug.cgi?id=865108), [bug 604374](https://bugzilla.mozilla.org/show_bug.cgi?id=604374)); one [support answer](https://support.mozilla.org/en-US/questions/1259005) suggests a lower practical limit. The build therefore keeps the bookmarklet under 60,000 characters.

## How browsers decide Tab order

No browser API reports the sequential focus order, so the tool computes it and the tests compare the result with real Tab presses.

- **tabindex:** positive values first (ascending, ties in DOM order), then `0` and naturally focusable elements in DOM order. `-1` is focusable but never reached by Tab ([WHATWG, "Focusing on focus"](https://blog.whatwg.org/focusing-on-focus)).
- **Scopes:** ordering applies within each focus navigation scope (a shadow root, or a slot's content), which is then inserted where its owner sits. A `tabindex="5"` inside a component does not jump ahead of the whole page.
- **Excluded:** `display: none`, `visibility: hidden`, `inert` content (including everything outside an open modal `<dialog>`), disabled controls, and the contents of a closed `<details>` other than its `<summary>`.
- **Still reached, though invisible:** zero-size, off-screen, `opacity: 0` and clipped elements. The tool flags these, except skip links that become visible on focus.
- **Radio groups:** one stop per group (the checked option, or the first).
- **Scroll boxes:** in Chrome and Firefox, a scrollable element with nothing focusable inside is itself a stop.
- **Safari:** by default its Tab key only reaches text fields, pop-up menus and `<details>` summaries, plus anything with a `tabindex`. Links, buttons, checkboxes and similar are reached only with Option+Tab, or when "Press Tab to highlight each item" is on (Safari Settings, Advanced). Scroll boxes are never stops. Confirmed with real key presses in WebKit on macOS.
- **Scrolling on focus:** in all three engines, Tab leaves on-screen items where they are (even if something covers them) and centres off-screen items. Script `focus()` scrolls differently: WebKit scrolls even on-screen items, and Firefox applies the scroll later. So the tool focuses without scrolling, then scrolls like Tab. Confirmed against real key presses in each engine.
- **CSS `reading-flow` / `reading-order`:** these change Tab order, but only in Chrome and Edge ([caniuse](https://caniuse.com/wf-reading-flow), [Chrome blog](https://developer.chrome.com/blog/reading-flow)). The tool notes them but does not model them yet.

## Licences

- **axe-core:** MPL-2.0 ([package](https://www.jsdelivr.com/package/npm/axe-core)). MPL is copyleft per file: changes to axe's own files must be shared, but surrounding code can use any licence. It is bundled unmodified, with its licence texts shipped beside the bundle. (Not legal advice.)
- **dom-accessibility-api:** MIT ([package](https://classic.yarnpkg.com/en/package/dom-accessibility-api)).

## Time model sources

There is no published standard for "seconds per Tab stop with a screen reader", so the model's values are starting assumptions, all adjustable in `config/defaults.json`.

- **Key press:** the Keystroke-Level Model gives 0.28 s for an average user, with a range of 0.12 to 1.2 s ([Kieras](https://web.eecs.umich.edu/~kieras/docs/GOMS/KLM.pdf); [Card, Moran and Newell, 1980](https://www.researchgate.net/publication/220426122_The_Keystroke-Level_Model_for_User_Performance_Time_with_Interactive_Systems)). That is typing time, not time to decide, so it is a floor.
- **Speech rate:** a large study found a mean listening rate of about 309 words per minute, faster for visually impaired participants ([Bragg et al.](https://danibragg.com/papers/listening_rates.pdf)). That is a ceiling for comprehension, not everyday speed. Default screen reader rates are lower; the model's 180 words per minute is an assumption.
- **Experts** often cut speech off and move on, so the expert profile hears only the first few words (an assumption).

## WCAG 2.2 mapping

| Issue | Success criterion | Note |
|---|---|---|
| Visual order differs from DOM order | [1.3.2 Meaningful Sequence](https://www.w3.org/WAI/WCAG22/Understanding/meaningful-sequence.html) | Fails only if meaning changes, so the tool says "suggested" |
| No way to skip repeated content | [2.4.1 Bypass Blocks](https://www.w3.org/WAI/WCAG22/Understanding/bypass-blocks.html) | Landmarks or headings can also satisfy it |
| Positive tabindex, illogical order, focusable but invisible | [2.4.3 Focus Order](https://www.w3.org/WAI/WCAG22/Understanding/focus-order.html), [2.4.7 Focus Visible](https://www.w3.org/WAI/WCAG22/Understanding/focus-visible.html) | |
| Keyboard trap | [2.1.2 No Keyboard Trap](https://www.w3.org/WAI/WCAG22/Understanding/no-keyboard-trap.html) | |
| Focus hidden under sticky or fixed content | [2.4.11 Focus Not Obscured (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html), failure [F110](https://www.w3.org/WAI/WCAG22/Techniques/failures/F110.html) | Fails only if entirely hidden; 2.4.12 (AAA) asks for full visibility |
| Skipped heading levels, multiple H1 | none directly; related to [1.3.1](https://www.w3.org/WAI/WCAG22/Understanding/info-and-relationships.html) | Best practice, not a failure. axe-core also tags these rules as best practice |
