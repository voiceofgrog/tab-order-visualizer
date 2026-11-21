# Validation against a real page

Run: 2026-11-20, the `apnews.com` home page, Playwright Chromium (headless), 1366×900.

The validation script is read-only: it presses Tab and nothing else. Optionally it first clicks one named button, here the cookie banner's "Reject Non-Essential", in a throwaway browser profile. Command:

```powershell
$env:VALIDATE_URL = 'https://apnews.com/'; $env:VALIDATE_DISMISS = 'Reject Non-Essential'; $env:VALIDATE_MAX_PRESSES = '900'; npm.cmd run validate
```

The report and screenshot go to `reports/`, which git ignores. Live pages change from load to load (ads, banners, carousels), so the numbers vary a little between runs.

## Results

| Check | Result | How verified |
|---|---|---|
| Cookie dialog open (fresh profile) | The tool analyses only the dialog's 4 controls and says why; the browser cycles through exactly those 4 | Real Tab presses |
| Tab order, whole page | 403–404 of about 406 stops in the same order as real Tab presses, to the end of the page | Real Tab presses compared with the tool's list |
| Focus hidden under fixed or sticky content (tabbing forwards) | The tool flagged 173 of the 179 items that were really covered (97%) | Hit test on the focused item after each real Tab press |

## Differences, and what they were

| Difference | Cause | Tool bug? |
|---|---|---|
| The tool listed all 415 page stops behind the cookie dialog, with 415 "possible trap" and 343 "covered" findings | The dialog is a `div` with `aria-modal="true"` whose script keeps Tab inside | **Yes, fixed:** script-managed modals are detected and trap findings are grouped |
| The tool counted a scrollable off-canvas menu as a stop | The scroll-box rule did not check `visibility: hidden` | **Yes, fixed** (demo case and test added) |
| 2 carousel links "never reached"; 2 other links seen instead | The slideshow probably advanced between the scan and the key presses (inferred) | No: live content changed |
| 1 ad iframe not in the tool's list | Ad inserted after the scan (inferred) | No: live content changed |
| Footer "never reached" (early runs) | The test's key-press budget was used up inside ad iframes | No: test bug, fixed |
| 6 covered items the tool missed | A banner's presence varies between loads and may change during a run (inferred) | Unclear |
| 36 items flagged covered that were not covered tabbing forwards | The tool also tests Shift+Tab from the bottom (sticky header); this script only walks forwards. Not checked item by item | Unclear |

## Limits of this kind of check

The tool cannot see inside cross-origin iframes (ads, video players, embedded widgets), so it cannot tell whether focus can get back out of one. Where a page embeds such content, also check it by hand with the keyboard.
