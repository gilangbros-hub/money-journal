# CatatBoros Phase 1 & 2: Feature Enhancement Specification

## 📅 Overview
This document details the technical requirements, data model changes, and UI/UX flows for the first two phases of the CatatBoros enhancement roadmap.

---

# 🚀 Phase 1: Quick Wins (High Impact, Low Friction)
**Goal:** Improve daily usability and data entry efficiency without major architectural shifts.

## 1. Recurring Transactions
### Problem
Users manually enter the same transactions every month (Rent, Netflix, Gym), leading to forgotten entries and inconsistent data.

### Data Model Changes (`Transaction.js`)
Add the following fields to the existing Transaction schema:
```javascript
{
  // ... existing fields
  isRecurring: { type: Boolean, default: false },
  recurrencePattern: {
    frequency: { type: String, enum: ['daily', 'weekly', 'monthly', 'yearly'], default: 'monthly' },
    interval: { type: Number, default: 1 }, // e.g., every 2 weeks
    nextDueDate: { type: Date },
    endDate: { type: Date } // Optional stop date
  },
  autoCreatedFrom: { type: mongoose.Schema.Types.ObjectId, ref: 'Transaction' } // Link to template
}
```

### Backend Logic
1.  **Cron Job / Daily Scheduler**: Create a server-side job (e.g., using `node-cron`) running at 00:01 AM.
2.  **Query**: Find all active recurring transactions where `nextDueDate <= today`.
3.  **Action**:
    - Clone the transaction.
    - Set `date` to today.
    - Set `autoCreatedFrom` to the original ID.
    - Update original `nextDueDate` based on frequency.
    - Save new transaction.

### Frontend UI (`AddTransaction.jsx`)
- **Toggle**: "Make this recurring?" switch.
- **Conditional Form**: If toggled, show:
  - Frequency Dropdown (Daily, Weekly, Monthly).
  - "Ends on" date picker (optional).
- **Visual Indicator**: In History list, show a 🔄 icon for auto-generated items. Clicking it reveals "Original Template".

---

## 2. Global Search
### Problem
As history grows, finding a specific transaction (e.g., "Dinner with John") is impossible without scrolling.

### Backend API (`transaction.controller.js`)
- **Endpoint**: `GET /api/transactions/search?q=keyword`
- **Logic**:
  ```javascript
  const results = await Transaction.find({
    user: req.user.id,
    $or: [
      { note: { $regex: query, $options: 'i' } },
      { category: { $regex: query, $options: 'i' } },
      { merchant: { $regex: query, $options: 'i' } } // If merchant field exists
    ]
  }).sort({ date: -1 }).limit(50);
  ```

### Frontend UI (`History.jsx`)
- **Component**: Sticky search bar at the top of the History page.
- **Behavior**:
  - Debounced input (300ms).
  - Real-time filtering of the current list OR hit Enter to fetch from API.
  - Highlight matching text in results.
  - "No results found" empty state.

---

## 3. Transaction Tags
### Problem
Categories are too broad (e.g., "Food" doesn't distinguish between "Groceries" and "Business Lunch").

### Data Model Changes (`Transaction.js`)
```javascript
{
  // ... existing fields
  tags: [{ type: String }] // e.g., ["vacation", "urgent", "tax-deductible"]
}
```
*Note: Maintain a separate `Tag` collection per user to suggest existing tags, or keep it simple with free-text strings.*

### Frontend UI
- **Input**: Multi-select chip input (like Gmail labels).
- **Suggestions**: Show previously used tags as the user types.
- **Filtering**: Add a "Filter by Tag" dropdown in the History view.
- **Display**: Small colored pills next to the transaction amount.

---

# 🛡️ Phase 2: Strategic Value (Financial Planning)
**Goal:** Transform the app from a tracker to a financial planner.

## 4. Budget Rollover (Carry-Over)
### Problem
Users feel pressured to "use up" their budget at month-end, or feel discouraged when they overspend slightly one month despite saving the previous month.

### Data Model Changes (`Pocket.js` or `Budget.js`)
```javascript
{
  // ... existing fields
  allowRollover: { type: Boolean, default: false },
  carriedOverAmount: { type: Number, default: 0 } // Positive = surplus, Negative = deficit
}
```

### Backend Logic (Month-End Closing)
- **Trigger**: When the user locks the month or automatically on the 1st of the new month.
- **Calculation**:
  ```javascript
  const surplus = pocket.budgetLimit - pocket.totalSpent;
  if (pocket.allowRollover) {
      nextMonthPocket.startingBalance += surplus; 
      // Or adjust the effective limit: nextMonthPocket.effectiveLimit = baseLimit + surplus
  }
  ```
- **Constraint**: Ensure logic handles negative carry-over (debt) correctly.

### Frontend UI (`Dashboard.jsx` & `PocketDetail.jsx`)
- **Visual**: Show a distinct section: "Carried Over: +$50k".
- **Graph**: Update the "Budget Used" bar to show `Base Budget` vs `Effective Budget (with rollover)`.
- **Settings**: Toggle "Enable Rollover" in Pocket settings.

---

## 5. Savings Goals Tracker
### Problem
Budgeting is defensive (don't spend); users need offensive goals (save for X).

### New Data Model (`Goal.js`)
```javascript
const GoalSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: 'User' },
  name: { type: String, required: true }, // e.g., "New Laptop"
  targetAmount: { type: Number, required: true },
  currentAmount: { type: Number, default: 0 },
  deadline: { type: Date },
  color: { type: String, default: '#3b82f6' },
  linkedPocket: { type: Schema.Types.ObjectId, ref: 'Pocket' }, // Optional: auto-allocate from pocket
  completed: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});
```

### Backend API
- `POST /api/goals`: Create goal.
- `PUT /api/goals/:id/contribute`: Add funds (manual entry or transfer from pocket).
- `GET /api/goals`: List all active/completed goals.

### Frontend UI (`Goals.jsx` - New Page)
- **Card Layout**: Grid of goal cards.
- **Progress Bar**: Visual % completion.
- **"Add Funds" Modal**: Quick input to move money from a Pocket to a Goal.
- **Confetti Effect**: Trigger animation when `currentAmount >= targetAmount`.

---

## 6. Dark Mode Toggle
### Problem
Modern UX expectation; reduces eye strain at night.

### Implementation Strategy (Tailwind CSS)
1.  **Config**: Ensure `tailwind.config.js` has `darkMode: 'class'`.
2.  **State Management**:
    - Use React Context (`ThemeContext`) to manage `isDark` state.
    - Persist preference in `localStorage`.
    - Apply `dark` class to the `<html>` or `<body>` tag.
3.  **Styling**:
    - Replace hardcoded colors with Tailwind semantic classes:
      - `bg-white` → `bg-white dark:bg-gray-900`
      - `text-gray-900` → `text-gray-900 dark:text-gray-100`
      - `border-gray-200` → `border-gray-200 dark:border-gray-700`
4.  **UI Component**: Sun/Moon toggle button in the Navbar or User Profile dropdown.

---

# 🧪 Testing & Acceptance Criteria

## Phase 1 Criteria
- [ ] **Recurring**: A monthly transaction created on Jan 15th automatically appears on Feb 15th without user intervention.
- [ ] **Search**: Typing "Netflix" instantly filters the history list to show only Netflix transactions.
- [ ] **Tags**: Users can add multiple tags to a transaction and filter the history view by clicking a tag pill.

## Phase 2 Criteria
- [ ] **Rollover**: If I save $20k in January (of a $100k budget), my February budget effectively shows as $120k (if enabled).
- [ ] **Goals**: Creating a goal shows a progress bar. Adding funds updates the bar immediately. Completing a goal triggers a visual celebration.
- [ ] **Dark Mode**: Toggling the switch instantly inverts colors across all pages without reloading. Preferences persist after browser refresh.

# 🔧 Technical Debt Considerations
- **Indexing**: Add MongoDB indexes on `tags`, `note`, and `isRecurring` fields to ensure search and cron jobs remain fast as data grows.
- **Timezones**: Ensure the Cron job and `nextDueDate` calculations handle user timezones correctly (store UTC, compute locally).
