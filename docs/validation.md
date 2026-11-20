# Validation against a real page

Run: 2026-11-20, `apnews.com` home page, Playwright Chromium (headless), 1366×900.
Read-only: the script presses Tab and nothing else. With the owner's go-ahead it clicked the
cookie banner's "Reject Non-Essential" in the throwaway test profile. Command:

```powershell
$env:VALIDATE_URL = 'https://apnews.com/'; $env:VALIDATE_DISMISS = 'Reject Non-Essential'; $env:VALIDATE_MAX_PRESSES = '900'; npm.cmd run validate
```

The report and screenshot go to `reports/`, which git ignores. Live pages change from load to load
(ads, banners, carousels), so the numbers below vary a little between runs.

## Results

| Check | Result | How verified |
|---|---|---|
| Cookie dialog open (fresh profile) | Tool analyses only the dialog's 4 controls and says why; the browser cycles through exactly those 4 | Real Tab presses |
| Tab order, whole page | 403–404 of ~406 stops in the same order as real Tab presses, to the end of the page | Real Tab presses vs tool list |
| Focus hidden under fixed/sticky content (forwards) | Tool flagged 173 of the 179 items that were really covered (97%) | 5-point hit test after each real Tab press |

## Differences, and what they were

| Difference | Cause | Tool bug? |
|---|---|---|
| Tool listed all 415 page stops behind the cookie dialog; 415 "possible trap" and 343 "covered" findings | Dialog is a `div` with `aria-modal="true"` whose script keeps Tab inside | **Yes, fixed:** script-managed modals detected; trap findings grouped |
| Tool counted a scrollable off-canvas menu as a stop | The scroll-box rule did not check `visibility: hidden` | **Yes, fixed** (demo and test added) |
| 2 carousel links "never reached"; 2 other links seen instead | The slideshow probably advanced between scan and key presses (inferred) | No: live content changed |
| 1 ad iframe not in the tool's list | Ad inserted after the scan (inferred) | No: live content changed |
| Footer "never reached" (early runs) | Test budget used up inside ad iframes | No: test bug, fixed |
| 6 covered items the tool missed | The donation banner's presence varies between loads and may change during a run (inferred) | Unclear |
| 36 items flagged covered that were not covered tabbing forwards | Tool also tests Shift+Tab from the bottom (sticky header); this script only walks forwards. Not checked item by item | Unclear |

## Unconfirmed finding about the page itself

In two of five runs, after an embedded games widget (an iframe from a third-party site) loaded,
705 further Tab presses all stayed inside it, so nothing after it was reachable. In the other runs
focus passed straight through. Inside the widget, focus sat on the frame's body and did not move.
This may be a real keyboard trap, or an artefact of headless Chromium handling focus across nested
cross-site frames. **Needs a manual check in a normal browser.** The tool cannot see inside
cross-origin frames, so it cannot detect this kind of trap.
