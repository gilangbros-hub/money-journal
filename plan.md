# UI/UX improvement plan

A step-by-step plan for improving the money tracking flow: Log Spending, Monthly Story, Review History and navigation. Do the phases in order. Each phase is one commit. Don't start a new phase until the current one has passed its checks.

## Status

- **Phase 1: done.** Deviation: after saving an edit, the page returns to where the edit was opened from (same-origin referrer), falling back to `/review-history`.
- **Phase 2: done.** Deviations: Undo also puts the deleted entry's values back in the form so it can be fixed and saved again. After a save, the date, type and pocket are kept (only amount, note and split rows reset). On Log Spending the toast sits at the top of the screen, because at the bottom it covered the Save button for the 5 s it stays up. `showToast` now uses `textContent` instead of `innerText`.
- **Phase 3: done.** Deviations: the `+` sits above the navbar (not at its old spot, which the bar now covers), and both sit below `.modal-overlay` so dialogs cover them. Story, History and Pockets headers lost their "← Back" link and click-to-home wrapper (they're tabs now), and so did the Log Spending title (tapping it navigated away mid-entry). Monthly Story and Profile got the missing `#message` toast element; their `showToast` calls were silently dropped before. Nav icons have fixed-size boxes so a failed icon-font load clips instead of spilling text. The CSS variable `--bottom-nav-height` sets the bar height; the toast and `+` positions derive from it.
- Phases 4 to 6: not started.

## Ground rules for whoever runs this

- Work on branch `claude/money-tracking-ui-ux-pvfnrh`. Commit after each phase with a message like `feat(log-spending): ...` or `fix(log-spending): ...`, the same style as `git log`.
- Stick to the files each phase names. Don't refactor anything else, rename existing IDs/classes, or reformat whole files.
- Leave the server alone unless a phase says to change it. Most of this is client-side (`views/*.hbs`, `public/js/*.js`, `src/input.css`).
- If you touch CSS in `src/input.css`, rebuild with `npm run build:css` and commit the regenerated `public/css/tailwind.css` too.
- Checks to run after each phase:
  - `npm run test:ui`
  - `npm run test:unit`
  - Both have to pass. The UI tests render the `.hbs` views in JSDOM and run the page script (see `test/ui/logSpending.test.js`). If you change an ID or a flow that a test depends on, update the test in the same commit and explain why in the message.
- Every phase adds at least one test to the matching file under `test/ui/`. Copy the existing `setupPage` / fake `fetch` pattern.
- Expense type management, pocket management and salary-cycle budgeting all sit behind feature flags (see `config.js`). Anything you build has to work with each flag on **and** off.
- If a step doesn't match what you find in the code (a function has been renamed, a field is missing), stop and write down the mismatch in the commit message or a note. Don't guess.

## Phase 1: bugs

### 1a. The Log Spending type picker uses managed expense types

Problem: the category list is hardcoded in `views/log-spending.hbs` (the two `{{#each (split "Eat,Snack,...")}}` blocks) and in `TYPE_META` at the top of `public/js/log-spending.js`. Types created on `/expense-type-management` show up in the Telegram bot but not on the web form.

Steps:

1. In `controllers/transactionController.js` → `getTransactionPage`, pass `expenseTypeManagementEnabled: req.app?.locals?.configuration?.expenseTypeManagementEnabled === true` to the view. First check `app.js` and `config.js` to confirm the configuration key is really called that, and use the real name if it isn't.
2. In `views/log-spending.hbs`, add `<input type="hidden" id="expenseTypeManagementEnabled" value="{{expenseTypeManagementEnabled}}">` next to the existing `salaryCycleEnabled` hidden input. Leave the hardcoded lists where they are; they're the fallback when the flag is off.
3. In `public/js/log-spending.js`, add `loadManagedExpenseTypes()`:
   - If the flag input isn't `'true'`, return and keep the hardcoded list.
   - Fetch `GET /api/expense-types`. The response looks like `{ success: true, data: { active: [{ id, name, emoji, ... }] } }`.
   - On success, rebuild **both** the hidden radio inputs inside `.transaction-hidden-types` and the buttons inside `#typeSheet .picker-grid` from `data.active`, keeping the same markup, classes and `data-type-option` attributes. Use `escapeHtml` for name and emoji.
   - Put each type's emoji into `TYPE_META[name] = { icon: emoji }` so `updateTypeDisplay` shows it.
   - The type button click handlers are attached directly to each button right now, which won't survive a rebuild. Switch to one delegated listener on `#typeSheet`, the same way `#pocketSheet` does it.
   - After rebuilding, re-apply the current selection. If the selected type isn't in the new list, fall back to the first active type.
   - If the fetch fails, keep the hardcoded list and don't show an error toast.
4. Call it from `DOMContentLoaded`. When editing, `loadTransactionForEdit` calls `setSelectedType(transaction.type)` and may run before the types load, so once the types load, call `setSelectedType` again with the saved type.
5. Do the same emoji fallback in `public/js/monthly-story.js` and `public/js/review-history.js`: both have a static `typeEmojis` map. If the flag is on, fetch `/api/expense-types` once and merge `name → emoji` into `typeEmojis` before rendering. Each page's view and controller needs the same hidden input and flag. Stop at merging emojis; don't change any other rendering.

Tests (`test/ui/logSpending.test.js`):
- Flag on, and fetch returns a custom type `{ name: 'Parkir', emoji: '🅿️' }` → a `[data-type-option="Parkir"]` button exists, and clicking it updates `#selectedTypeDisplay`.
- Flag off → the hardcoded list is unchanged and `/api/expense-types` is never fetched.

### 1b. Edits no longer bump the streak or trigger confetti

In the submit handler in `public/js/log-spending.js`, only call `bumpStreak()` and `launchConfetti` when `!isEdit`. For an edit, show `showToast('Transaction updated', 'success')` and send the user to `/review-history` after about 800 ms.

Test: in edit mode, a successful PUT leaves `localStorage.moneyJournalStreak` unchanged.

Commit: `fix(log-spending): use managed expense types; edits do not bump streak`

## Phase 2: faster logging

Goal: a routine entry takes amount → save, three taps or fewer.

### 2a. Remember the last pocket and category

1. After a successful **create**, save `{ type, pocketId }` to localStorage under `moneyJournalLastPick`, plus a per-type map under `moneyJournalPocketByType` (`{ [type]: pocketId }`). Wrap every read and write in try/catch.
2. On page load (not in edit mode):
   - Preselect the last type instead of hardcoding `'Eat'`.
   - Once pocket options load (`applyManagedPocketOptions`), if nothing is selected yet, preselect `pocketByType[currentType]`, falling back to `lastPick.pocketId`. Only do this if that pocket ID exists in `managedPocketById`.
3. When the user picks a type in the sheet and hasn't manually picked a pocket in this session, switch the pocket to `pocketByType[type]` if it exists. Track manual choice with a `pocketChosenManually` flag that gets set in `selectManagedPocket` when it's called from a click.
4. `addAnother()` currently resets the type to `'Eat'` and clears the pocket. Apply the same remembered defaults there instead.

Tests: seed localStorage, load the page, and check that `#selectedPocketDisplay` shows the remembered pocket. Then check that a stale pocket ID (not in the options) is ignored.

### 2b. Amount input

1. In `views/log-spending.hbs`, change `#amount` to `type="text" inputmode="numeric" autocomplete="off"`, and add `autofocus` when not in edit mode.
2. In the JS, add `getTransactionAmount()`-compatible parsing: strip everything except digits. Format the display live using `.` as the thousands separator (`35.000`) and keep the caret at the end. Every place that reads `document.getElementById('amount').value` as a number must go through one `parseAmountInput()` helper. That covers `getTransactionAmount`, `validateForm` and the submit payload. Grep for `'amount'` to find them all.
3. Make sure the submit payload still sends a plain number string (`"35000"`). The server validator accepts that; see `utils/transactionValidators.js` around line 36.
4. Add a `000` button inside `.transaction-counter` that appends three zeros and refires the input handler. Style it like the existing pill buttons.
5. When editing, format the loaded amount.

Tests: typing `35000` shows `35.000` and submits `amount: "35000"`. The `000` button turns `35` into `35.000`.

### 2c. Description becomes optional

The server requires `ngapain`, so leave it as is. On the client:
1. Remove `required` from `#ngapain` and change the placeholder to `Note (optional)`.
2. In the submit handler, if the note is blank, send the selected type name. That's what the Telegram bot does when you skip the note (`services/telegramBotService.js` `skipNote`).

Test: submit with an empty note → the payload has `ngapain === selected type`.

### 2d. Replace the success modal with an undo toast

1. After a successful **create**: don't open `#successModal`. Reset the form in place using the Phase 2a defaults, focus `#amount`, and show a toast reading `Saved · Rp 35.000` with an **Undo** button.
2. `showToast` lives in `public/js/common.js`. Add an optional action argument (`showToast(message, type, { actionLabel, onAction })`) that renders a button inside the toast and keeps it open for about 5 seconds. Existing callers must behave exactly as before.
3. Undo calls `DELETE /api/transaction/:id`. Right now the create response doesn't include an ID: `createTransaction` in `controllers/transactionController.js` (around line 48) throws away the result of `service.createExpense`. This is the one server change in this phase:
   - Capture the result (`const created = await service.createExpense(...)`). It should be the saved Mongoose document (see `services/transactionService.js` `createExpense`, around line 487). Check that before relying on it.
   - Add `id: created?._id ? String(created._id) : undefined` to the JSON response. Keep `success` and `message` unchanged.
   - Add an assertion for `id` in `test/transactionController.test.js`.
   - If `createExpense` doesn't return the document, don't dig further. Ship the toast without Undo and write that down in the commit message.
   - Undo also has to roll back the streak bump. Store the previous streak value before bumping.
4. Only fire confetti when the streak count hits 7, 30 or 100.
5. Delete the `#successModal` markup and `addAnother()` once nothing references them. Update any tests that pointed at them.

Commit: `feat(log-spending): remembered defaults, formatted amount, optional note, undo toast`

## Phase 3: navigation

1. Drop the 3-second welcome splash. In `controllers/authController.js` (around line 53), redirect after login to `/monthly-story` instead of `/welcome`. Keep the `/welcome` route working, but change the timeout in `views/welcome.hbs` to 1200 ms and add a click-anywhere-to-continue handler.
2. Use `views/partials/navbar.hbs` as the only primary navigation:
   - Change its items to **Story** (`/monthly-story`), **History** (`/review-history`) and **Pockets** (`/check-pockets`), using the Material Symbols icons the action hub already uses rather than emoji.
   - Add an active flag for History. Each page controller passes the right `isX: true`. Find the render calls with `grep -rn "res.render(" controllers`.
   - Include `{{> navbar}}` on monthly-story, review-history, check-pockets, profile and pocket-management. Add bottom padding to `.page-container` so the bar doesn't cover content. Check that `.bottom-navbar` styles exist in `src/input.css`, and add them if they don't.
3. Turn the `+` in `views/partials/actionHub.hbs` into a plain link to `/log-spending` (keep the class and position, drop the sheet). Delete the sheet markup and its JS. Find the JS with `grep -rn actionHub public/js`.
4. Remove the `journal-strip` section from `views/monthly-story.hbs`.
5. On Log Spending, change "← Back" to use `history.back()` when `document.referrer` is same-origin, and `/monthly-story` otherwise.

Tests: update `test/ui/monthlyStory.test.js` and `test/ui/reviewHistory.test.js` if they assert on the strip or the hub. Add one assertion that the navbar renders with the correct active item.

Commit: `feat(nav): single bottom navbar, + goes straight to Log Spending`

## Phase 4: Monthly Story shows what's left

`GET /api/dashboard/summary` already returns `budget` (the full budget view, with `budget.pockets[]`, each having `spent`, `budget`, `percentageUsed`, `cadence`, `alertStatus`) and `period` (`startDate`, `endDate`). No server change needed. Before building anything, log one real response (or read `services/reportingService.js` around line 370 and `services/budgetService.js`) to confirm the field names.

1. Hero in `views/monthly-story.hbs` / `renderHero()`:
   - Main number: **Left this cycle** = sum of `budget - spent` over pockets where `cadence !== 'Weekly'`. Keep weekly pockets out of this sum, because their budget is per week.
   - Subline: `Rp X/day · N days to payday`, where N = days from household today (`householdTodayKey`) through `period.endDate` inclusive. If N ≤ 0, or there's no period, hide the subline.
   - Replace the metric trio with **Spent** (the current total), **Today** and **Days left**. Drop **Entries**.
   - If the summary has no budget or no pockets, fall back to the current hero exactly as it is today.
2. Pocket Pulse (`renderPocketPulse()`): render **every** pocket from `budget.pockets` as a row showing name, `spent / budget`, and a thin progress bar coloured by `alertStatus` (normal/warning/danger). Keep the existing alert copy as the row subtitle for warning/danger rows. Sort danger first, then warning, then the rest.
3. Remove the duplicate Chart.js `<script>` in the `<head>` of `views/monthly-story.hbs` (the unversioned one) and keep the pinned `4.4.1` one at the bottom. Remove `chartjs-plugin-datalabels` only if `grep -n datalabels public/js/monthly-story.js` finds nothing. If it's used, leave it and move it after the pinned Chart.js.
4. Remove the **Today Feed** section. The Month Feed's first group already covers today.

Tests in `test/ui/monthlyStory.test.js`:
- A summary with two monthly pockets (budget 1.000.000 spent 400.000, budget 500.000 spent 500.000) and `period.endDate` 10 days out → the hero shows Rp 600.000 left and 10 days.
- A summary with no pockets → the old hero renders.

Commit: `feat(monthly-story): hero shows budget left and daily allowance; pulse lists every pocket`

## Phase 5: split pockets and edit/delete

1. **Split behind a link**: in `views/log-spending.hbs`, hide `.transaction-mode-toggle` by default and add a small `Split across pockets` text button under the Pocket row that switches to multi mode (it checks `#sourceTypeMulti` and calls `handleSourceTypeChange`). In multi mode, show a `Use one pocket` link that switches back. Edit mode for a multi transaction must still open in multi mode.
2. **Fill remaining**: in `addBreakdownRow`, add a small `Rest` button to each row that sets that row's amount to `transactionAmount - (sum of the other rows)`, with a floor of 0, and then calls `updateBreakdownTotal()`.
3. **Row tap to edit**: in `public/js/monthly-story.js` `renderFeedRow` and the equivalent in `public/js/review-history.js`, make the whole row a link to `/log-spending?edit=<id>` and remove the inline Edit/Delete links.
4. **Delete moves into the edit screen**: on Log Spending in edit mode, show a `Delete transaction` danger button under Save. It uses a confirm modal (copy the `#deleteModal` markup from review-history), calls `DELETE /api/transaction/:id`, then goes to `/review-history`.
5. Remove the now-unused delete modal and handlers from monthly-story and review-history only if nothing else calls them (check with grep).

Tests: split link toggles modes. `Rest` fills the correct amount. Edit mode shows the delete button and create mode doesn't. Feed rows link to the edit URL.

Commit: `feat(log-spending): split behind a link, fill remaining, delete from edit screen`

## Phase 6: search in Review History

1. Add a search input above the filter pills in `views/review-history.hbs`.
2. In `public/js/review-history.js`, filter the already-loaded month transactions on the client by case-insensitive substring match on `ngapain`, `type` and `pocket`. Debounce by 150 ms. Apply it together with the existing type/pocket filters and recompute the summary card (count and total).
3. No server change. The search only covers the selected month; say that in the placeholder: `Search this month`.

Test: typing `galon` leaves only matching rows, and the summary total updates.

Commit: `feat(review-history): search within the month`

## Out of scope (don't do these)

- Moving the streak to the server. It's per-device in localStorage and doesn't count Telegram entries. That needs a real decision (derive it from transaction dates on the server, or drop it) and belongs in a separate change.
- Visual redesign, theme or colour changes, or new fonts.
- Any change to pocket management, budget allocation or the Telegram bot.
