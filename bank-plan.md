# Bank per pocket plan

Every pocket lives in one bank (Jago, Blu, Superbank, ...). Picking a bank is mandatory when creating a pocket, each pocket shows its bank's logo, and Check Pockets shows how much is left per bank.

Do the phases in order, one commit each. Same ground rules as `plan.md`: stick to the named files, run `npm run test:unit` and `npm run test:ui` after every phase, add at least one test per phase, and rebuild `public/css/tailwind.css` if `src/input.css` changes.

## Decisions (read these before building)

**What "money left in a bank" means.** The app doesn't know real bank balances. It knows, per pocket, allocation minus spending for the salary cycle. So the bank number is the sum of `remaining` over the pockets in that bank: "budget left in Jago", not "Jago balance". It will drift from the Jago app whenever money moves outside the journal (transfers, interest, unallocated cash, refunds). The label on screen has to say "left in budget" so nobody reconciles against it and panics. Real balance tracking (typing in the actual balance and seeing the gap) is a separate feature and not in this plan.

**Which remaining.** Use each pocket's whole-cycle `periodMetrics` (`allocation - spending`), the same numbers `calculateBudgetAggregate` already sums into `totalRemaining`. Weekly pockets count with their whole-cycle allocation, not just the selected week. Overspent pockets count negative, because the overspend came out of that bank. Invariant: the bank totals add up to `totalRemaining` exactly.

**Bank list is a fixed catalogue in code, not a managed collection.** `utils/banks.js` exports an ordered list of `{ key, name, color, logo }`. Start with: `jago` (Bank Jago), `blu` (blu by BCA Digital), `superbank` (Superbank), `seabank` (SeaBank), `bca` (BCA), `mandiri` (Mandiri), `bri` (BRI), `bni` (BNI), `jenius` (Jenius), `gopay` (GoPay), `cash` (Cash). Adding a bank later is one line plus one logo file. A CRUD screen with logo upload is a lot of machinery for a list that changes once a year. Stored value on the pocket is the `key`, so renaming a display name never touches data.

**Logos.** Files live in `public/images/banks/<key>.svg` (PNG allowed where no clean SVG exists, 96x96, transparent). Source them from each bank's official site or press kit, or Wikimedia Commons, and keep a line per file in `public/images/banks/SOURCES.md` saying where it came from. Personal household use, so trademark risk is a shrug, but the source list keeps it honest. Every logo renders through one helper with a fallback: if the file is missing or fails to load (`onerror`), show a round badge in the bank's `color` with its first letter. That means Phase 1 ships without waiting on logo hunting, and a bad download never shows a broken-image icon. `cash` uses a Material Symbols `payments` icon instead of a logo.

**Only managed pockets get a bank.** Pockets come from `PocketDefinition` when `POCKET_MANAGEMENT_ENABLED` is on. With the flag off, pockets are the hardcoded `POCKETS` constant and there's nothing to "create", so the whole bank feature is hidden and every flag-off view stays byte-for-byte unchanged. Assumption: the flag is on in production. If it isn't, this plan needs a static `POCKETS -> bank` map first, and that's a different conversation.

**No snapshot on assignments.** `PocketAssignment` snapshots name and emoji per month. Bank is read live from the definition instead. Moving Groceries from Jago to Blu mid-cycle should move its remaining to Blu right away, because that's where the money physically is now. Past months will also show the current bank; acceptable, since nobody audits last March by bank.

**Mandatory, with existing pockets handled.** New pockets must have a bank (validated in the service, required in the form). Existing pockets have none, so the Mongoose field stays optional (no backfill migration, no broken reads). Those pockets show "No bank" with a nudge to edit, count under an "Unassigned" row in the bank totals, and the edit form requires a bank on save. Once every pocket has one, the Unassigned row disappears on its own.

## Phase 1: bank catalogue and the pocket field

1. `utils/banks.js`: `BANKS` array as above, `BANK_KEYS`, `findBank(key)`. Colours are the banks' primary brand colours as hex.
2. `models/pocketDefinition.js`: add `bank: { type: String, enum: BANK_KEYS, required: false }`. Include `bank` in `toDTO()`. Don't bump `schemaVersion`; the field is additive and optional.
3. `services/pocketValidation.js`: add `bank` to `DEFINITION_FIELD_ORDER` and the field validators. `validatePocketBank(raw)` trims, lowercases, and rejects anything not in `BANK_KEYS` with field `bank`. On create: missing bank is a validation error ("Choose the bank this pocket lives in"). On update: bank is optional in the PATCH body, but if present it must be valid, and sending `bank: null` or `''` is rejected (you can change a bank, not remove it).
4. `services/pocketManagementService.js`: `createPocketDefinition` and `updatePocketDefinition` persist `bank`. Changing only the bank still increments `version`, same as any accepted change.
5. Tests: create without bank fails with a `bank` field error; create with `'Jago '` stores `jago`; unknown bank fails; update from `jago` to `blu` bumps version; update with `bank: null` fails; an old definition without `bank` still loads and its DTO has `bank: undefined`.

## Phase 2: pick a bank on Pocket Management

1. `controllers/pocketController.js`: pass `banks: BANKS` to the pocket management view.
2. `views/pocket-management.hbs`: in both the create and edit forms, add a bank picker after the emoji field. A grid of logo tiles (radio inputs `name="bank"`, logo plus name underneath), not a `<select>`, because the logos are the point. Create form: no default selected, `required`. Edit form: preselect the pocket's bank; if it has none, nothing preselected and a small amber note "Pick a bank for this pocket".
3. `views/partials/bankLogo.hbs`: the one logo helper. `<img src="/images/banks/{{key}}.svg" alt="{{name}}" onerror>` plus the letter-badge fallback. Client-side rendering in `public/js` gets a matching `bankLogoHtml(bank)` in `public/js/common.js` so server and client produce the same markup. Escape the name.
4. `public/js/pocket-management.js`: send `bank` in create and PATCH bodies, show the server's `bank` field error inline like the other fields, and show the logo on each pocket row in the list. Rows without a bank get a "No bank" chip.
5. Tests (`test/ui/pocketManagementView.test.js`): submitting create without a bank shows the error and doesn't POST; picking Blu sends `bank: 'blu'`; an existing pocket without a bank renders the "No bank" chip; a logo `<img>` firing `error` swaps to the letter badge.

## Phase 3: bank totals in the budget summary

1. `services/budgetService.js`, managed view (`buildManagedBudgetMonthView`): load the definitions for the month's pocket ids in one query (`_id: { $in: ids }`, projection `bank`) and put `bank` on each pocket row. Legacy fallback rows in the dual-read path get `bank: null`.
2. Add `banks` to the summary response: one entry per bank that has at least one pocket this month, `{ key, name, color, pocketCount, allocation, spending, remaining, formattedRemaining, isOver }`, summed from each pocket's `periodMetrics`. Order by the catalogue order, with `unassigned` (`name: 'No bank'`) last. Flag off: no `banks` key at all.
3. Tests (`test/budgetService` or the closest existing file): two Jago pockets and one Blu pocket give two entries with the right sums; a weekly pocket contributes its whole-cycle remaining, not the selected week; an overspent pocket makes its bank's remaining go down; sum of `banks[].remaining` equals `totalRemaining`; a pocket without a bank lands in `unassigned`; flag off returns no `banks`.

## Phase 4: show it on Check Pockets

1. `views/check-pockets.hbs` and `public/js/check-pockets.js`: a "By bank" strip under the hero card, above the pocket list. One horizontally scrollable card per bank: logo, bank name, remaining (coral when negative), "3 pockets", and the label "left in budget". Hidden when `banks` is missing or empty.
2. Tapping a bank card filters the pocket list to that bank; tapping it again (or an "All" chip) clears the filter. Filter lives in the page only, not the URL.
3. Each pocket card gets a small logo badge next to its name.
4. Tests (`test/ui/checkPocketsView.test.js`, `checkPocketsInteractions.test.js`): strip renders one card per `banks` entry with the formatted remaining; negative remaining gets `text-coral`; tapping Jago leaves only Jago pockets visible; no `banks` in the response means no strip.

## Phase 5: logos on Log Spending (small, optional)

The pocket picker in `#pocketSheet` shows the bank logo on each pocket button, so while logging you can see "Groceries, Jago" and pay with the right card. Needs `bank` on `/api/expense-pocket-options` rows (`listExpensePocketOptions`, read live from the definition like Phase 3). Test: a pocket option with `bank: 'jago'` renders the Jago logo in the sheet.

## Phase 6: logo files

Drop the real logo files into `public/images/banks/`, fill in `SOURCES.md`, and check each one on the dark and light theme. Kept last on purpose: everything before this works with the letter badges, so a missing or ugly logo never blocks the feature.

## Out of scope

Real balance tracking and reconciliation against the bank app. Transfers between banks. Managing the bank list from the UI. Telegram bot changes (the bot doesn't create pockets; it could show the bank in pocket choices later, but nobody's asked). Per-month bank snapshots.
