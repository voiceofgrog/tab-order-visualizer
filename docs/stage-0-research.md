# Stage 0: Research findings

Date: 2026-11-20. Labels used below:
- **[V]** verified from a source linked in that section
- **[I]** inferred, or from my own knowledge without a fresh source; check before relying on it

---

## 1. Existing tools

| Tool | What it does | What it does not do |
|---|---|---|
| [Tab Order Visualizer](https://chromewebstore.google.com/detail/apnammgabgdjpmcjajbfbmeiejigpjph) (Chrome) | Numbered badges in tab order, toggle by shortcut/popup. v1.0, May 2026, ~4 users [V] | No arrows, issues, suggested order or timing [I, from listing] |
| [Tab Order Checker](https://chromewebstore.google.com/detail/tab-order-checker/pefibaogdlgickocjjdmmmfabnmmnikd) (Chrome) | Visualises tab order. ~36 users [V] | Same gaps as above [I] |
| [taba11y](https://chromewebstore.google.com/detail/taba11y-tab-order-accessi/aocppmckdocdjkphmofnklcjhdidgmga) ([Firefox](https://addons.mozilla.org/addon/taba11y/)) | Draws a path or highlights elements in tab order. ~10k users, the established one. A reviewer says it struggles with floating menus [V] | No suggested order, no WCAG explanations, no timing [I] |
| [Roselli reading-order bookmarklet](https://adrianroselli.com/2019/04/reading-order-bookmarklet.html) | Numbers the children of one flex/grid container in DOM order, so you see where visual order and source order differ. 2019 proof of concept and the basis of Chromium's Source Order Viewer [V] | Reading order of one container, not tab order of the page [V] |
| [Chromium Source Order Viewer](https://adrianroselli.com/2020/09/source-order-viewer-in-edge-86.html) (DevTools) | Overlays DOM source order for a chosen container [V] | Source order, not focus order. DevTools only [V] |
| [Firefox "Show Tabbing Order"](https://firefox-source-docs.mozilla.org/devtools-user/accessibility_inspector/) | Built-in overlay of focus order, since Fx 84. Static snapshot. [Slow on big sites](https://bugzilla.mozilla.org/show_bug.cgi?id=1702897) [V] | No issues, suggestion or timing. DevTools only [V] |
| [Accessibility Insights Tab Stops](https://accessibilityinsights.io/docs/web/getstarted/assessment/) | Numbers stops as you tab, auto-detects some possible issues, then you review them by hand [V] | Computes nothing ahead of time: you do the tabbing [V] |
| [Deque Keyboard IGT](https://docs.deque.com/devtools-for-web/4/en/devtools-igt-keyboard) | Guided test that records tab stops and uses AI to check focus indicators, roles and visibility. Commercial (axe DevTools Pro) [V] | Not free; no time model [I] |
| [Tactual](https://raw.githubusercontent.com/tactual-dev/tactual/HEAD/README.md) (npm) | CLI/library/MCP. Builds a navigation graph from Playwright accessibility snapshots and scores how hard screen reader users find it to discover and reach targets, per AT profile (NVDA/JAWS/VoiceOver). Supports CI and diffs [V, from README/directories] | Node + Playwright, not an in-page overlay. Scores, not seconds [I]. Early-stage, few stars [V] |

**Newer finds:** [FocusFlow Inspector](https://addons.mozilla.org/addon/focusflow-inspector/) (Firefox, MIT, Mar 2026, overlay of focus order), [Focus Order Validator](https://addons.mozilla.org/en-US/firefox/addon/focus-order-validator) (experimental: tab order, traps), [Focus Flow Plus](https://addons.mozilla.org/pl/firefox/addon/focus-flow-plus/), [A11yFocus](https://addons.mozilla.org/en-CA/firefox/addon/a11yfocus) (DevTools: focus resets), [Storybook keyboard-nav visualizer](https://storybook.js.org/addons/storybook-addon-keyboard-nav-visualizer). [V that they exist; I did not install any]

**Your gap hypothesis:** I confirmed it as far as listings show. I found nothing free that draws a *suggested* order next to the real order, or that gives *time in seconds*. Tactual is the nearest on effort, but as a Node CLI score, not an overlay. Caveat: I read store listings, not the tools themselves. Some small extensions may do more than they advertise. [I]

---

## 2. Bookmarklets and Content Security Policy

- The CSP spec says a policy "should not interfere with" bookmarklets and extensions, but browsers have varied. ([Firefox bug 866522](https://bugzilla.mozilla.org/show_bug.cgi?id=866522), [W3C thread](https://lists.w3.org/Archives/Public/public-webappsec/2014Jul/0063.html)) [V]
- My understanding is that current Chrome and Firefox (Firefox since about v69, when 866522 closed) run the bookmarklet's **own inline code** even on strict-CSP pages. What CSP still blocks is anything the bookmarklet **loads or creates**: `<script src>` from a host the page doesn't allow, `eval`, inline `<style>` under a strict `style-src`, and `innerHTML` under Trusted Types. Sources conflict here, including one 2026 blog post saying Chrome blocks it. **[I] We'll test this on a strict-CSP demo page in Stage 1.**
- **The bigger problem is size.** axe-core minified is roughly 500 KB [I]. A bookmarklet that includes it is a half-megabyte URL. Chrome may accept it; other browsers and bookmark sync may not. **[I] Unverified.**
- Extensions (MV3 with `activeTab` + `scripting`) inject code as privileged scripts that page CSP generally doesn't block, with no size limit ([activeTab docs](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab)) [V]. Exceptions: no `chrome://` pages, no cross-origin iframes, and a reported hang when frames have certain CSP headers ([issue 715](https://www.github.com/GoogleChrome/chrome-extensions-samples/issues/715)) [V].

**Recommendation: one bundle, two delivery wrappers.**
1. **Core bookmarklet:** self-contained and inline, with no fetching. Order, overlay, our own checks and the time model. Small, perhaps 30-60 KB [I].
2. **Full build:** the same bundle plus axe-core, loaded as an unpacked MV3 extension (one manifest, one click, no store publishing). It's also what the demo page and Playwright tests load.
Overlay code avoids `innerHTML` and `eval`, and styles via `adoptedStyleSheets` in the shadow root, so it survives Trusted Types and most `style-src` rules. [I: verify in Stage 1]

---

## 3. Computing the real tab order

No browser API returns the sequential focus order, so we have to compute it. That makes the Playwright Tab-press tests the ground truth. [V, by absence; [WHATWG "Focusing on focus"](https://blog.whatwg.org/focusing-on-focus)]

Rules to implement:
- **tabindex:** positive values first, ascending, with ties in tree order; then `0`/natural order in tree order. `-1` is focusable but never tabbable. [V, WHATWG blog]
- **Scopes (Shadow DOM, slots):** the tabindex ordering applies *within* each focus navigation scope (a shadow root, a slot, or a `reading-flow` container). Scopes are then flattened in at the host's position. So `tabindex="5"` inside a component does not jump ahead of the whole page. [V, WHATWG blog]
- **Closed shadow roots** can't be seen from page script. We report them as "unknown contents" [I]. Extensions can use `chrome.dom.openOrClosedShadowRoot` [I].
- **`delegatesFocus`:** the host isn't a stop itself; focus goes to its first focusable descendant. [I]
- **CSS `reading-flow` / `reading-order`:** shipped in Chrome/Edge 137. Not in Firefox or Safari ([caniuse](https://caniuse.com/wf-reading-flow), [Chrome blog](https://developer.chrome.com/blog/reading-flow)) [V]. It changes real tab order in Chromium only, so the tool must detect it and either follow it or warn that the order varies by browser.
- **Excluded:** `display:none`, `visibility:hidden/collapse`, `inert` subtrees and anything outside an open modal `<dialog>` (inert as well), `disabled` form controls, and contents of closed `<details>` other than its `<summary>`. [V for inert, via [tabbable docs](https://npmjs.com/package/tabbable); others I]
- **`display:contents`:** the element has no box, but its children are still tabbable. A `display:contents` element can itself be tabbable in some browsers, an old bug [I]. Use `checkVisibility()`, not `offsetParent`.
- **Zero-size, off-screen, `opacity:0`, `clip`:** *still tabbable*. These are the "focusable but invisible" cases we flag rather than drop. Visually-hidden skip links are the legitimate case: they become visible on focus. [I]
- **Radio groups:** one stop per group (same `name`, same form): the checked one, else the first. Browsers are inconsistent when none is checked ([tabbable notes](https://npmjs.com/package/tabbable)) [V].
- **Scroll containers:** since roughly Chrome 130, a scrollable element with no focusable children is itself a tab stop. Firefox has done this longer. [I: version to verify]
- **iframes:** same-origin ones we can walk into. Cross-origin ones show as one opaque stop ("contents unknown"). [I]
- **Also tabbable:** `contenteditable`, `<summary>`, `<audio controls>`/`<video controls>`, `<a href>` (not `<a>` without href), `<area href>`, and `<iframe>`. [I]
- **Library option:** [tabbable](https://npmjs.com/package/tabbable) (MIT) handles visibility, inert, radios and opt-in open shadow roots. It does **not** know about `reading-flow` or scroll containers [I]. We can use it for candidate detection and do our own ordering, or write our own (~200 lines).

---

## 4. Licenses

- **axe-core: MPL-2.0** ([jsDelivr](https://www.jsdelivr.com/package/npm/axe-core), [package.json](https://www.github.com/dequelabs/axe-core/blob/develop/package.json)) [V]. MPL is copyleft *per file*: if you change axe's own files you must share those changes, but your code can use any license. Bundling it unmodified in a free public tool is fine as long as we keep its license notice and point to where its source is. axe ships a `LICENSE-3RD-PARTY.txt` that we should carry through as well. [V on license; I on the obligations. I'm not a lawyer.]
- **dom-accessibility-api: MIT** ([yarn](https://classic.yarnpkg.com/en/package/dom-accessibility-api)) [V]. Bundling it is fine with attribution.
- **tabbable: MIT** [I]
- Both are "unusual" only in that MPL isn't permissive. **Your call (see decisions).**

---

## 5. Timing assumptions

There is **no published standard for "seconds per tab stop with a screen reader."** Everything below is a defensible *starting* assumption, labelled adjustable.

- **Key press:** the Keystroke-Level Model gives K = 0.28 s for an average user, with a range of 0.12 (expert) to 1.2 s ([Kieras, KLM](https://web.eecs.umich.edu/~kieras/docs/GOMS/KLM.pdf); [Card, Moran & Newell 1980](https://www.researchgate.net/publication/220426122_The_Keystroke-Level_Model_for_User_Performance_Time_with_Interactive_Systems)) [V]. KLM is typing time, not the time to decide to press Tab again, so this is a floor. [I]
- **Speech rate:** Bragg et al.'s large study measured a mean listening rate of about 309 wpm, and visually impaired participants were faster, about 330 wpm ([paper](https://danibragg.com/papers/listening_rates.pdf)) [V]. That's a ceiling for comprehension, not typical everyday speed. Many people's comprehension falls off around 250-300 wpm ([secondary report](https://japan.co.jp/e/reports/japan-synthetic-speech-speed-comprehension-accessibility-2026.html), small sample) [V, weak]. Screen reader defaults are slower, roughly 180-200 wpm [I].
- **Experts often don't listen to the whole announcement.** They interrupt speech by pressing Tab again, so "full announcement" overestimates expert time. [I]

**Proposed defaults (config file, all adjustable):**

| Profile | s per Tab | Speech wpm | Listens to |
|---|---|---|---|
| Sighted keyboard | 0.6 | none | none; adds visual-find time per stop (assumed 0.3 s, **no source**) |
| Screen reader, casual | 0.5 | 180 | full name + role |
| Screen reader, expert | 0.28 | 300 | first ~3 words, then skips ahead (assumption) |

---

## 6. WCAG 2.2 mapping

| Issue | SC | Notes |
|---|---|---|
| Visual order ≠ source/DOM order | [1.3.2 Meaningful Sequence (A)](https://www.w3.org/WAI/WCAG22/Understanding/meaningful-sequence.html) | Only fails if the meaning changes. Hence "suggested", not a verdict |
| No skip link / bypass | [2.4.1 Bypass Blocks (A)](https://www.w3.org/WAI/WCAG22/Understanding/bypass-blocks.html) | Landmarks or headings also satisfy it; axe `bypass` checks for all of these |
| Positive tabindex, illogical order, hidden-but-focusable | [2.4.3 Focus Order (A)](https://www.w3.org/WAI/WCAG22/Understanding/focus-order.html) | |
| Headings that don't describe content | [2.4.6 Headings and Labels (AA)](https://www.w3.org/WAI/WCAG22/Understanding/headings-and-labels.html) | Mostly needs a person; we can flag empty headings |
| No visible focus indicator | [2.4.7 Focus Visible (AA)](https://www.w3.org/WAI/WCAG22/Understanding/focus-visible.html) | |
| Focus hidden under a sticky header/footer | [2.4.11 Focus Not Obscured (Min) (AA)](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html), failure [F110](https://www.w3.org/WAI/WCAG22/Techniques/failures/F110.html) | Fails only if *entirely* hidden; partial overlap passes (2.4.12 AAA wants full visibility) |
| **Keyboard trap** | **[2.1.2 No Keyboard Trap (A)](https://www.w3.org/WAI/WCAG22/Understanding/no-keyboard-trap.html)** | Missing from your list; I suggest adding it |
| Skipped heading levels, multiple H1 | none directly; [1.3.1 Info and Relationships](https://www.w3.org/WAI/WCAG22/Understanding/info-and-relationships.html) at most | **Surprise:** axe tags `heading-order`, `page-has-heading-one` and `tabindex` as *best-practice*, not WCAG failures [I, from axe rule metadata]. Multiple H1s isn't a WCAG failure. We should say so |

---

## Recommendation

Build it. The gap is real: nothing free gives suggested-order arrows or a time-to-reach estimate. Ship one TypeScript bundle in two wrappers: a small inline bookmarklet (no axe) and a full build with axe-core, used by the demo page, the tests and an unpacked MV3 extension. Write our own order algorithm (tabbable as reference, or as a dependency for visibility checks only). Treat Playwright Tab presses as ground truth, Chromium first, with Firefox as a second project to expose `reading-flow` and scroll-container differences.
