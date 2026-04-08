# Add Transaction - Card-Centric Refactor

> **Objective**: Transform the mobile Add Transaction screen into a unified card-driven interface where all interactions happen inline inside cards.
> **Target Screen**: `mobile-app/src/screens/AddTransactionScreen.js`
> **Design Direction**: Adopt the clean light minimalist card design, but replace the current multi-section layout with an editable card-centric flow.

---

## Product Goals

- Remove separate page sections like `Expense Type`, `Pocket Source`, and `Timing & Budget` as standalone blocks.
- Consolidate the experience into one primary transaction card with embedded selectors and one expandable detail area.
- Keep all edits inline on the same screen without navigation jumps.
- Preserve the existing save API contract, closed-month logic, and success modal flow.

---

## UI Architecture

### 1. Screen Container

- Use a scrollable near-white background (#F8FAFC) with 16-20px horizontal padding.
- Keep the current header and sticky bottom CTA.
- Reserve enough bottom padding so content never hides behind the sticky save button.

### 2. Primary Transaction Card

**Component: `TransactionCard`**

This becomes the dominant card on the page and replaces the current multi-block layout.

It contains:

- **Header Row**
  - Editable category chip
  - Editable date chip
- **Description Area**
  - Inline editable text field
  - Placeholder: `What did you spend on?`
- **Amount Area**
  - Large formatted amount display: `Rp 55.000`
  - Tap display to enter amount edit mode
  - Inline numeric input replaces the display while editing
- **Embedded Selectors**
  - Expense type chips
  - Pocket source chips
- **Expandable Detail Area**
  - Accordion section for timing and budget settings

### 3. Expandable Detail Area

**Component: `ExpandableCardSection`**

Label: `Timing & Budget`

Collapsed by default.

Contains:

- Date & time picker trigger
- Budget month selector
- Closed month visual state with disabled interaction

This section expands inside the same card instead of appearing as a separate card stack below.

---

## Component System

Create reusable local components inside the screen file first, then extract only if reuse becomes clear.

### `CardContainer`

- Shared rounded white card shell (#FFFFFF)
- Supports gradient or solid variants
- Applies border, soft shadow, and active ring states

### `EditableText`

- Displays text in read mode
- Switches to `TextInput` inline when activated
- Used for description and optional chip labels if needed later

### `CurrencyInput`

- Handles raw numeric state and formatted display state
- Supports:
  - tap to edit
  - numeric keyboard
  - blur to exit edit mode
  - live Rupiah formatting

### `ChipSelector`

- Horizontal single-select chip row
- Works for:
  - category / expense type
  - pocket source
- Supports icon + label + selected styling

### `ExpandableSection`

- Accordion row with chevron
- Animated expand/collapse
- Holds timing and budget controls inline

### `BottomCTAButton`

- Sticky bottom action
- Full width
- Keeps current `Save Transaction` label and loading behavior

---

## State Management Refactor

Replace the loosely separated editing behavior with a centralized screen state model.

```ts
type TransactionState = {
  amount: string
  description: string
  category: string
  expenseType: string
  pocketSource: string
  date: Date
  budgetMonthKey: string
  isEditingAmount: boolean
  isEditingDescription: boolean
  isDetailsExpanded: boolean
  isCategorySheetOpen: boolean
  isDatePickerOpen: boolean
}
```

### Mapping to existing app logic

- `description` maps to current `ngapain`
- `expenseType` maps to current `type`
- `pocketSource` maps to current `pocket`
- `budgetMonthKey` derives from the existing `budgetMonth` object
- Save payload must remain:
  - `amount`
  - `ngapain`
  - `type`
  - `pocket`
  - `budgetMonth`
  - `budgetYear`
  - `date`

---

## Interaction Rules

### Amount

- Tapping the amount display activates inline edit mode.
- Show the numeric input in the same visual slot.
- On blur or submit:
  - sanitize digits
  - keep value in state
  - return to formatted display mode

### Category

- Tapping the category chip opens a bottom sheet selector.
- Use the existing type data as the source of truth unless product later separates category from expense type.
- Selecting an item closes the sheet and updates the chip immediately.

### Date

- Tapping the date chip opens the existing date picker modal.
- Keep current `DateTimePicker` integration.

### Description

- Description is always inline inside the card.
- Support immediate editing without moving to another section.

### Timing & Budget

- Accordion is collapsed by default.
- Expand/collapse inline with animation.
- No navigation and no separate section block below the card.

---

## Layout Refactor Plan

### Current layout to remove

- Separate `SelectionRail` block for expense type
- Separate `SelectionRail` block for pocket source
- Separate `Timing & Budget` card outside the main hero card
- Separate amount display plus dedicated `Edit amount` block

### New layout to build

1. Header
2. Primary `TransactionCard`
3. Sticky `Save Transaction` CTA
4. Existing success modal

Inside the transaction card:

1. Editable header chips
2. Description field
3. Inline amount display/input
4. Expense type chip rail
5. Pocket source chip rail
6. Expandable `Timing & Budget` section

---

## Visual Design Rules

- Maintain clean white/light theme with a single minimal white card as the main visual anchor.
- Use one strong card instead of multiple equally weighted sections.
- Rounded corners should stay soft and premium: 24-32px on the main card, 16-20px on embedded elements.
- Use subtle shadows, not neon glow overload.
- Active editing states should be clear via border tint, background shift, or soft blue ring.
- Chips should feel embedded into the card, not like detached section controls.

---

## Animation & UX

- Add quick transitions for:
  - amount display <-> amount input
  - accordion expand/collapse
  - active chip state
- Target 150-250ms ease-out motion.
- Avoid page jumps, scroll repositioning, or context switching.
- Keyboard interaction should feel stable:
  - no content jumping under the sticky CTA
  - description and amount remain visible while editing

Optional polish after core refactor:

- Tap outside to dismiss amount editing
- Auto-focus amount input when entering edit mode
- Haptic feedback on chip selection
- Persist last used category as a future enhancement

---

## Implementation Steps

### Phase 1 - Card Shell Refactor

- Introduce `TransactionCard` wrapper inside `AddTransactionScreen`
- Move category, date, description, and amount into the same card
- Remove the standalone `Edit amount` block

### Phase 2 - Inline Editing

- Add `isEditingAmount`
- Convert amount display into display/input toggle
- Keep formatted display logic and sanitized numeric save logic

### Phase 3 - Embedded Selectors

- Move expense type and pocket source selectors inside the transaction card
- Refactor selector UI into reusable chip rows
- Keep current datasets and selected values

### Phase 4 - Expandable Details

- Convert timing and budget controls into an inline accordion
- Preserve closed-month disabled behavior
- Preserve date picker behavior

### Phase 5 - Polish & Validation

- Verify sticky CTA spacing
- Verify keyboard behavior during inline edits
- Verify no payload changes on save
- Verify success modal flow still supports:
  - `Add Another Transaction`
  - `Go to Dashboard`

---

## Acceptance Criteria

- All primary transaction interactions happen inside the main card.
- Amount editing is inline and no longer uses a separate amount-edit section.
- Expense type and pocket source are embedded chip selectors inside the card.
- Timing and budget controls live inside a collapsible section in the card.
- The screen uses the clean, lightweight, minimal white card identity.
- Saving a transaction still hits the existing endpoint with the existing payload.
- Closed months remain disabled and visually obvious.

---

## Notes for Implementation

- The current screen already has good base assets which we will adapt: light theme tokens, single floating pill sticky save CTA, and modal flow.
- If a bottom sheet library is not already installed, implement a lightweight in-screen modal sheet first instead of adding a heavy new dependency.
- Keep the refactor self-contained to `AddTransactionScreen.js` unless a reusable component clearly benefits the rest of the mobile app.
