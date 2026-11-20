# Tab-Order Visualizer

See the order in which the **Tab key** moves through a web page, find problems with that order, compare it with a suggested order, and estimate how long keyboard and screen reader users take to reach things.

It draws numbered badges and arrows on the page itself, explains why each element sits where it does, and gives each problem a plain-language fix with a link to the relevant WCAG success criterion. It is meant for editors and developers who are not accessibility specialists, and for anyone who wants to learn how browsers decide focus order.

**Everything runs in your browser. Nothing is sent anywhere: no network requests, no analytics, no tracking, and nothing is stored.**

**Install it from the website: [voiceofgrog.github.io/tab-order-visualizer](https://voiceofgrog.github.io/tab-order-visualizer/)** (bookmarklet, extension download, and demo pages to try it on). The bookmarklet carries all its code inside itself, so once it's installed, using it never contacts the website.

## What it shows

| On the page | Meaning |
|---|---|
| Round badge, solid arrow | Real Tab order (what the browser will do) |
| Square badge, dashed arrow | Suggested order, based on visual reading order |
| Dashed round badge and outline | Focusable but not visible |
| Thicker arrow labelled "back" | Tab order jumps backwards on screen |

The panel (bottom right) has:
- **Show:** real order, suggested order, or both. Arrows, outlines and dim-page toggles. Colour presets (including high contrast and a set for dark pages) and three sizes.
- **Step through:** previous and next stop, with the reasons for each stop's position.
- **Time to reach (estimate):** choose a target from the list, or pick it on the page. You get a table of estimated times for three user profiles, plus what a skip link or the suggested order would save.
- **Issues:** each issue has a severity (**Fail**, **Review**, **Advice**), what is wrong and why it matters, how to fix it, WCAG links, and **Show** buttons that point at the elements.

Keyboard: opening the tool moves focus to the panel. **Alt+Shift+T** moves between the page and the panel, and **Escape** returns to the page. The shortcut can be changed in `config/defaults.json`.

## Install

You need Node.js 20 or later. On Windows, use `npm.cmd` if PowerShell blocks `npm`.

```powershell
npm.cmd install
npm.cmd run build
```

This creates `dist/`:

| File | Use |
|---|---|
| `dist/install.html` | Page with the bookmarklet link to drag to your bookmarks bar |
| `dist/extension/` | Unpacked browser extension (full build, including axe-core checks) |
| `dist/tov-full.js` | Full script (core + axe-core), for pages and tests you control |
| `dist/tov.js` | Core script, the source of the bookmarklet |

### Bookmarklet (no install, any browser)

1. Run `npm.cmd run serve` and open `http://127.0.0.1:4173/dist/install.html`.
2. Drag **Tab order** to your bookmarks bar. If dragging doesn't work, open **Can't drag it? Add it by hand**, choose **Copy code**, and paste the code as the URL of a new bookmark.
3. On any page, click the bookmark. Click it again to close.

The install page also explains what the tool does. It and the panel follow your system's light or dark setting.

The bookmarklet is about 52,000 characters. Firefox will not store a bookmark longer than 65,536 characters, so the build fails if the bookmarklet goes over 60,000. To stay small, it leaves out the axe-core checks and uses a simpler way to work out accessible names, so labels on unusual markup may be less exact than in the extension.

**Content Security Policy (CSP):** some sites restrict what scripts can run. The tool is built to keep working under strict policies (no `eval`, no `innerHTML`, styles applied through constructed stylesheets), and the tests check this on a strict demo page. Whether a browser lets a bookmarklet *start* on a strict page depends on the browser. If clicking it does nothing, check the browser console for a CSP message and use the extension instead.

### Extension (full checks, works on strict pages)

- **Chrome or Edge:** go to `chrome://extensions`, turn on Developer mode, choose **Load unpacked**, and select `dist/extension`.
- **Firefox:** go to `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on**, and select `dist/extension/manifest.json`. *Not yet tested in Firefox.*

Click the toolbar button to toggle the overlay. The extension only gets access to the tab you clicked it on, only until that tab navigates (the `activeTab` permission).

## How browsers decide Tab order

1. **What is focusable:** links with `href`, buttons, form fields, `<summary>`, elements with `contenteditable`, and anything with a valid `tabindex`.
2. **What Tab skips:** `tabindex="-1"`, disabled controls, anything `inert` or outside an open modal dialog, anything not rendered (`display: none`) or `visibility: hidden`, and content inside a closed `<details>`.
3. **Positive tabindex goes first:** `tabindex="1"`, then `"2"`, and so on, then everything else in source (HTML) order. This is why positive values cause jumpy navigation.
4. **Components are ordered separately:** content inside a Shadow DOM component, or slotted into it, is ordered within that component, and the group is then inserted where the component sits. A `tabindex="1"` inside a component does not jump ahead of the whole page.
5. **Special cases:**
   - A radio group is one stop (arrow keys move between its options).
   - A scrollable box with nothing focusable inside becomes a stop itself (Chrome and Firefox; not Safari).
6. **CSS does not change Tab order.** Moving content with `order`, `flex-direction: row-reverse` or grid placement changes what you see but not where Tab goes. The exception is CSS `reading-flow`, which only Chrome and Edge support so far. The tool flags it but does not model it yet.

## What it checks

| Check | Source | Severity | WCAG |
|---|---|---|---|
| Positive tabindex | axe-core | Review | 2.4.3 |
| Skipped heading levels / no H1 | axe-core | Advice | (1.3.1, best practice) |
| No way to bypass repeated content | axe-core | Fail | 2.4.1 |
| Scrollable area not keyboard-focusable everywhere | axe-core | Review | 2.1.1 |
| Focusable but invisible (skip links that appear on focus are fine) | this tool | Fail | 2.4.7, 2.4.3 |
| Focused item entirely covered by sticky or fixed content | this tool | Fail | 2.4.11 |
| Focused item partly covered | this tool | Advice | 2.4.12 (AAA) |
| Keyboard trap (Tab cancelled, focus stays) | this tool | Fail | 2.1.2 |
| Page script takes over Tab (normal in modal dialogs; check it) | this tool | Review | 2.1.2, 2.4.3 |
| Tab order jumps backwards against the visual layout | this tool | Review (suggested) | 2.4.3, 1.3.2 |
| More than one H1 | this tool | Advice | (1.3.1, best practice) |
| No skip link (when landmarks already satisfy 2.4.1) | this tool | Advice | 2.4.1 |

The **suggested order** is a heuristic. It groups stops by landmark (header, nav, main, aside, footer), then orders them top to bottom and left to right (right to left on right-to-left pages). Multi-column articles, sidebars and carousels can make it suggest changes that are not needed, which is why jumps are labelled "Review" and explained case by case.

## Time model (an estimate, not a measurement)

```
cost of one stop = seconds per Tab press
                 + words heard ÷ speech rate          (screen reader profiles)
                 + time to spot the focus on screen   (sighted profile)
time to reach    = sum of the costs of every stop up to the target
```

Words heard means the element's accessible name plus what a screen reader adds (role, such as "link" or "radio button", and state, such as "checked" or "2 of 3").

| Profile | Per Tab | Takes in each stop | Basis |
|---|---|---|---|
| Sighted keyboard user | 0.6 s | 0.3 s to spot focus | Key press from the Keystroke-Level Model (0.28 s average; Card, Moran and Newell, 1980) plus decision time. The 0.3 s spotting time is an **assumption with no published source**. |
| Screen reader, everyday | 0.5 s | Full announcement at 180 words/min | 180 words/min is roughly a default speech rate: an **assumption**, not from a study. |
| Screen reader, expert | 0.28 s | First 3 words at 300 words/min | Keystroke-Level Model key press. 300 words/min is near the mean listening rate in a large study (Bragg et al., CHI 2018). Cutting speech off after 3 words is an **assumption**. |

All values are in `config/defaults.json`. The model counts Tab presses only: experienced screen reader users also jump by heading, landmark or element type, so for them the real time is often shorter. Real announcements differ between NVDA, JAWS and VoiceOver.

## What it cannot do

- **It is not proof of accessibility.** Automated checks find only a subset of problems. A page with no issues reported can still be hard to use. Test with a keyboard and a screen reader, and with people who use them.
- **It is a snapshot.** Content that changes later (menus, carousels, lazy-loaded ads) needs **Refresh**.
- **It cannot see inside other sites' iframes** (ads, video players, embedded widgets), so it cannot find keyboard traps inside them. It also cannot see inside closed Shadow DOM components.
- **Keyboard traps** are found by sending a simulated Tab key, which skips text fields and editors (a simulated Tab could type a tab character). Traps built other ways, such as moving focus back when it leaves, are not detected.
- **Scanning briefly focuses each element** to check skip links and sticky headers, then restores focus and scroll position. Pages that react to focus (for example menus that open on focus) will see those events. Turn this off with `checks.measureFocus` and `checks.probeTabKey` in `config/defaults.json`.
- **CSS `reading-flow`** (Chrome and Edge only) is flagged, not modelled.

## Accuracy

Automated tests compare the tool with real Tab presses in Chromium (Playwright). These include a deliberately broken demo page, a well-built page used to catch false positives, a script-managed cookie dialog, and checks that sticky and fixed content covering focus matches what real key presses show.

On a live news site, the tool's order matched real Tab presses for 403 of about 406 stops. The remaining differences came from content that changed during the test. Details, and the two tool bugs that validation found and fixed, are in [docs/validation.md](docs/validation.md).

Firefox automation does not run on the development machine yet (Playwright's Firefox fails to start), so Firefox has had manual checks only.

## Development

```powershell
npm.cmd run build        # bundles, bookmarklet, extension
npm.cmd run typecheck
npm.cmd test             # Chromium tests (builds first)
npm.cmd run test:firefox # Firefox tests, where Playwright's Firefox runs
npm.cmd run serve        # demo pages at http://127.0.0.1:4173/demo/
```

To check the tool against a real page (read-only: it only presses Tab):

```powershell
$env:VALIDATE_URL = 'https://example.edu/'; npm.cmd run validate
```

Results go to `reports/`, which git ignores.

Demo pages: `demo/index.html` (deliberately broken), `demo/good.html` (well built), `demo/modal.html` (script-managed cookie dialog), `demo/csp.html` (strict Content Security Policy).

## License

MIT, see [LICENSE](LICENSE). Bundled third-party code keeps its own license (below).

## Third-party code

- **[axe-core](https://github.com/dequelabs/axe-core)** (MPL-2.0), unmodified, in the full build and extension. Its license texts are shipped as `THIRD-PARTY-LICENSES.txt` next to the bundle.
- **[dom-accessibility-api](https://github.com/eps1lon/dom-accessibility-api)** (MIT), in the full build.
