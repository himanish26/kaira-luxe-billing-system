# KLBS V1.1.0 NAV-01 Second Pass

## 1. Exact Reproduction

The defect occurs on both Email Configure and DSR Configure:

1. Open Configure.
2. Scroll the Configure page below the top.
3. Click the visible Back button or press Escape.
4. The Configure page first jumps to scroll position 0.
5. System Health then appears.

The required behavior is a direct transition without the intermediate Configure-page jump.

## 2. Pre-change State

- Branch: \`main\`
- HEAD: \`bec9a126cb6a56ba1daeeb121d86a7b00d15396d\`
- The worktree was intentionally dirty.
- Accepted Installment 1/2 PIN cosmetic changes were preserved.
- Previously accepted modal Escape cancellation changes were preserved.
- The first NAV-01 attempt, \`integrationNavigationInProgress\`, was preserved.
- No reset, restore, stash, clean, delete, stage, commit, or push was performed.

## 3. Complete Event/Handler Order Before the Fix

### Configure rendering

Both \`showEmailIntegrationForm()\` and \`showDsrIntegrationForm()\` call \`renderSettingsPage()\`. That function:

- replaces \`settingsPageContent.innerHTML\`;
- sets \`settingsScreen.style.display = "none"\`;
- sets \`settingsPage.style.display = "block"\`;
- schedules its normal initial \`requestAnimationFrame\` scroll-to-top for the newly rendered page;
- assigns the page-specific \`settingsPageBackBtn.onclick\` callback.

The initial Configure-page scroll-to-top is intentional when entering the page.

### Visible Back

The same \`settingsPageBackBtn\` has both:

1. a persistent \`addEventListener("click", ...)\` in \`src/renderer/app.js\`;
2. a page-specific \`.onclick\` assigned by \`renderSettingsPage()\`.

For Email/DSR Configure, the event order is:

1. the persistent listener runs;
2. it invalidates integration configuration requests;
3. it checks that a page-specific \`.onclick\` exists;
4. it unconditionally calls \`resetScrollPosition()\`;
5. the page-specific \`.onclick\` then runs \`leaveIntegrationConfiguration()\`;
6. \`leaveIntegrationConfiguration()\` starts \`showSystemHealthPage()\`;
7. System Health performs asynchronous IPC reads;
8. after those reads, \`renderSettingsPage()\` replaces Configure content with System Health.

### Escape

The global Escape path in \`src/renderer/modules/shortcuts.js\` calls:

\`settingsPageBackBtn.click()\`

Therefore Escape reaches exactly the same two Back-button handlers and produces the same ordering and scroll reset.

## 4. Exact Root Cause

The Configure page jump is caused by the persistent Back-button listener in \`src/renderer/app.js\`:

\`resetScrollPosition()\`

It runs before the integration-specific \`onclick\` callback and before \`showSystemHealthPage()\` completes.

This is not caused by preserving/restoring scroll position and not caused by a second Configure \`innerHTML\` replacement. The old Configure DOM remains visible while the destination IPC reads are pending; the explicit scroll reset makes that still-visible Configure page jump to the top.

## 5. Why the First NAV-01 Fix Was Insufficient

The earlier \`integrationNavigationInProgress\` guard only prevented a second call to the asynchronous integration exit path:

- it did not change the persistent Back-button listener;
- it did not prevent \`resetScrollPosition()\`;
- it did not run early enough to suppress the first visible reset.

It remains useful for preventing repeated Back/Escape activations from starting competing asynchronous System Health loads, but it cannot solve the scroll defect by itself.

## 6. Exact Local Fix

A narrow page-state marker was added:

- Email Configure sets \`settingsPage.dataset.integrationConfigure = "true"\`.
- DSR Configure sets the same marker.
- The persistent settings Back listener skips \`resetScrollPosition()\` only when that marker is true.
- System Health clears the marker after its destination render completes.

This produces:

Configure at scroll Y > 0
-> Back or Escape
-> no Configure scroll reset
-> existing integration exit path
-> System Health render

No scroll position is saved or restored. No animation, delay, timeout, or timing workaround was added.

## 7. Integration Navigation Guard

\`integrationNavigationInProgress\` remains in \`src/renderer/modules/system/integrations.js\`.

Reason:

- the marker fixes the first visible scroll reset;
- the guard still prevents repeated Back/Escape activations during the asynchronous destination load;
- the guard is released with \`finally\`, including failure paths;
- removing it would reintroduce competing asynchronous exits and is not necessary for this fix.

## 8. Files Changed for This Pass

- \`src/renderer/app.js\`
  - persistent settings Back listener now skips its reset only for marked Email/DSR Configure pages.
- \`src/renderer/modules/system/integrations.js\`
  - marks Email/DSR Configure pages;
  - clears the marker after System Health renders;
  - retains the existing integration exit re-entry guard.

Previously dirty files remain untouched except for the required local changes above.

## 9. Explicit Preservation Checks

- \`src/renderer/modules/shortcuts.js\`: unchanged.
- Previously accepted modal Escape cancellation: unchanged.
- Administrator and Manager PIN cosmetics: unchanged.
- F&F/Gift Voucher cosmetics: unchanged.
- No authorization, grant, PIN, security, billing, inventory, Day Closing, DSR, email, database, or business logic changes.
- No scroll-preservation workaround was introduced.
- No \`setTimeout\` or animation hack was introduced.

## 10. Validation

Commands run:

    node --check src/renderer/app.js
    node --check src/renderer/modules/system/integrations.js
    node --check src/renderer/modules/system/dayClosing.js
    git diff --check
    git diff --name-only
    git diff --stat
    git diff -- src/renderer/modules/shortcuts.js

Results:

- All JavaScript syntax checks passed.
- \`git diff --check\` passed.
- \`shortcuts.js\` produced no diff.
- The diff contains only the local second-pass marker/reset change in addition to the already accepted dirty work.
- No database was accessed.
- No network, email, DSR, or live application action occurred.

## 11. Manual Acceptance Steps

Use only:

    cd /d D:\KLBS\kaira-luxe-billing-system
    set "KLBS_DEV_DATABASE_PATH=D:\KLBS\KLBS_TRAINING_2026-09-21_REG02_RETEST.db"
    npm start

Test:

1. Open Email Configure, scroll to the middle/lower section, click Back, and confirm direct return without a Configure-page jump.
2. Repeat Email Configure from a lower scroll position using Escape.
3. Open DSR Configure, scroll down, click Back, and confirm direct return without a jump.
4. Repeat DSR Configure from a lower scroll position using Escape.
5. Open another ordinary Settings subpage and confirm its existing Back/Escape behavior is unchanged.
6. Open one safe modal and press Escape to confirm the previously accepted cancellation behavior still works.
7. Do not perform production billing, Day Reopen, email, DSR, or other live business actions for acceptance.

## 12. Remaining Risks

- Manual Windows Electron acceptance is still required to confirm the visual transition on the production display.
- The integration destination still performs its existing asynchronous IPC reads before rendering System Health; the fix removes the premature Configure scroll reset without changing that behavior.
- Existing worktree changes remain uncommitted by design.

## TASK

Perform the NAV-01 second-pass audit and minimal local fix for Configure-page scroll-to-top before Email/DSR exit.

## FILES INSPECTED

\`src/renderer/app.js\`, \`src/renderer/modules/system/integrations.js\`, \`src/renderer/modules/settingsLayout.js\`, \`src/renderer/modules/shortcuts.js\`, \`src/renderer/modules/system/dayClosing.js\`, and the existing dirty diff.

## FINDINGS

The persistent settings Back listener reset the Configure page scroll before the page-specific asynchronous integration exit. Escape programmatically used the same Back button and therefore reproduced the same sequence.

## FILES MODIFIED

\`src/renderer/app.js\` and \`src/renderer/modules/system/integrations.js\`.

## DATABASE CHANGES

None.

## BUSINESS LOGIC CHANGES

None.

## TESTS RUN

The three \`node --check\` commands, \`git diff --check\`, diff inspection, and confirmation of no \`shortcuts.js\` diff.

## TEST RESULTS

Passed. Manual Windows acceptance remains pending.

## SPECIFICATION CHECK

The root cause was fixed locally without changing global Escape navigation, preserving modal cancellation, accepted PIN cosmetics, and the existing integration destination behavior.

## RISKS / REMAINING ISSUES

Manual acceptance is required. No live actions were performed.

## FINAL STATUS

READY FOR MANUAL ACCEPTANCE
