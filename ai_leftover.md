# AI Leftover - Money Journal Development Context

> **Last Updated**: 2026-04-07
> **Purpose**: Provide full context so any AI can continue development from where we left off.

---

## Project Overview

**Money Journal** (CatatBoros) is a household expense tracking app with:
- **Web App**: Node.js + Express + MongoDB + Handlebars + Tailwind CSS (deployed to **Vercel** via GitHub auto-deploy)
- **Mobile App**: React Native (Expo) with NativeWind (deployed via **EAS Update** for OTA and **EAS Build** for APKs)

### Repos
| Platform | Path | Git Remote |
|----------|------|------------|
| Web/Backend | `c:\Users\Gilang\Documents\CatatBoros` | `gilangbros-hub/money-journal` |
| Mobile | `c:\Users\Gilang\Documents\CatatBoros\mobile-app` | `gilangbros-hub/money-journal-mobile` |

### Tech Stack
- **Backend**: Node.js, Express, MongoDB (Mongoose), session-based auth
- **Web Frontend**: Handlebars (HBS), Tailwind CSS, Vanilla JS, Chart.js
- **Mobile**: React Native (Expo SDK), NativeWind v2, react-navigation
- **Deployment**: Vercel (web), EAS Update + EAS Build (mobile)

---

## Architecture & Key Files

### Backend
| File | Purpose |
|------|---------|
| `controllers/transactionController.js` | CRUD for transactions, dashboard summary, closed-month validation |
| `controllers/budgetController.js` | Budget CRUD, month-level close/reopen, budget history |
| `models/transaction.js` | Transaction schema (date, type, pocket, amount, budgetMonth, budgetYear) |
| `models/pocketBudget.js` | Per-pocket budget allocation per month |
| `models/closedMonth.js` | Tracks which months are locked (month, year, closedBy) |
| `models/user.js` | User model with role (Wife/Husband), avatar, isActive |
| `routes/budget.js` | Budget API routes |
| `routes/transactions.js` | Transaction API routes |
| `utils/constants.js` | TRANSACTION_TYPES and POCKETS with icons |
| `utils/formatters.js` | Currency formatting (Rp) |

### Web Frontend
| File | Purpose |
|------|---------|
| `views/transaction.hbs` | Add Transaction form page |
| `views/allTransactions.hbs` | All Transactions listing page |
| `views/budget.hbs` | Budget Tracker page |
| `public/js/transaction.js` | Add Transaction form logic, closed month check |
| `public/js/allTransactions.js` | All Transactions filtering (type + pocket), sorting, delete |
| `public/js/budget.js` | Budget rendering, month-level close/reopen toggle |
| `public/js/common.js` | Shared utilities (toast, menu toggle) |

### Mobile App
| File | Purpose |
|------|---------|
| `src/screens/DashboardScreen.js` | Dashboard with compact colorful summary cards, category pulse chart, and recent transaction cards |
| `src/screens/AddTransactionScreen.js` | Card-centric add transaction flow with inline editing, category sheet, and accordion details |
| `src/screens/AllTransactionsScreen.js` | All transactions with type + pocket filtering |
| `src/screens/BudgetScreen.js` | Budget tracker with colorful compact pocket cards and month status card |
| `src/screens/ProfileScreen.js` | Profile + logout |
| `src/navigation/MainTabNavigator.js` | Tab navigation with floating dock-style taskbar and FAB (+) button |
| `src/api/axios.js` | Axios instance with base URL and auth interceptors |

---

## Key Design Decisions

### 1. Budget Closure is Month-Level (NOT Per-Pocket)
- The `ClosedMonth` model stores `{ month, year, closedBy }` with a unique compound index.
- When a month is closed: no budget edits, no new transactions for that month.
- Only the **Wife** role can close/reopen months.
- The old per-pocket `closed` field was **removed** from `PocketBudget`.

### 2. Authentication & Roles
- Session-based auth (express-session + connect-mongo).
- Two roles: **Wife** (full access, can edit budgets and close months) and **Husband** (view-only for budgets).
- Mobile uses API endpoints at `/api/auth/login` and `/api/auth/me`.

### 3. FAB Navigation (Mobile)
- The mobile tab bar now behaves like a rounded floating dock instead of a flat bottom strip.
- The (+) floating action button stays at **bottom-right** and is visually tuned to match the elevated card system.
- It is **hidden** when the user is on the Add Transaction screen.
- The "Add" tab is excluded from the tab bar rendering.

### 4. Post-Transaction Success Flow
- After saving a transaction, a modal appears with two choices:
  - `Add Another Transaction` -> resets form
  - `Go to Dashboard` -> navigates home
- This is implemented on both web (HTML modal) and mobile (React Native Modal).

### 5. Filtering System
- All Transactions screen has **two filter rows**:
  1. **Type filter**: Eat, Snack, Groceries, Laundry, Bensin, Flazz, etc.
  2. **Pocket filter**: Kwintals, Groceries, Weekday Transport, etc.
- Backend supports both via `type` and `pocket` query params on `GET /api/transactions`.

### 6. Mobile Card System Direction
- The mobile app is moving toward a compact, colorful, card-first design language.
- Each major screen uses clearly differentiated section cards with softer shadows, tighter spacing, and stronger visual hierarchy.
- Cards should feel compact and deliberate rather than like tall generic panels.

### 7. Mobile Add Transaction Direction
- The mobile Add Transaction screen now uses a card-centric interaction model.
- The main transaction card supports inline editing for description and amount, opens a bottom sheet for category selection, and uses an accordion for timing and budget controls.
- Expense types and pockets are embedded as chip selectors inside the main card instead of being separate page sections.
- The primary save action sits in a sticky footer above the safe area for easier reach.

### 8. Dashboard & Budget Direction
- Dashboard now uses compact colorful cards to separate total spending, category pulse, and recent transactions.
- Budget now uses compact colorful cards for month status, total budget summary, and each pocket allocation.
- Visual consistency across mobile screens is now centered around rounded elevated cards, compact spacing, and restrained shadows.

---

## Current State (What Was Last Done)

### Completed Features
1. Full CRUD for transactions and budgets
2. Dashboard with spending summary, pie chart, monthly comparison, budget alerts
3. Tailwind CSS "Tropis Neon" dark theme across all web pages
4. Month-level budget closure (Wife only)
5. Closed months disabled in Add Transaction budget month picker
6. Post-submit success modal (web + mobile)
7. FAB (+) button at bottom-right, floating with glow
8. Save Transaction button inline in form (web) and sticky in the redesigned mobile form
9. Pocket (budget type) filter on All Transactions (web + mobile)
10. Email notifications via Resend on new transactions
11. Export to Excel/CSV on history page
12. Integrated new custom `Money Journal` logo for the app icon, splash screen, and the mobile Login UI
13. Redesigned the mobile Add Transaction screen into an amount-first layout with a blue hero stage, horizontal selector rails, and a sticky save footer
14. Refactored the mobile Add Transaction screen into a card-centric inline-editing flow with an in-screen category sheet and accordion details
15. Unified the mobile Dashboard, Budget, and navigation taskbar around a compact colorful card system with a floating dock-style tab bar

### Known Issues / Potential Improvements
- OTA updates may not always apply immediately on older APK builds; user sometimes needs a new APK.
- The `cli.appVersionSource` field in `eas.json` should be configured per Expo's upcoming requirement.
- Expo package versions currently show minor SDK mismatch warnings in `expo-doctor` (`expo`, `expo-status-bar`, `expo-updates`, `react-native`, `react-native-svg`).
- No edit functionality for existing transactions in the mobile app (only delete).
- No dark/light mode toggle (currently dark-only).

---

## Deployment Workflow

### Web
1. Commit and push to `main` branch of `gilangbros-hub/money-journal`
2. Vercel auto-deploys from GitHub

### Mobile
1. Commit and push to `main` branch of `gilangbros-hub/money-journal-mobile`
2. OTA Update: `npx eas-cli update --branch main --environment production --message "description"`
3. APK Build: `npx eas-cli build -p android --profile preview --non-interactive`
4. Download APK from Expo Dashboard

### Important
- Always update `release_history.md` in the web repo on every commit.
- The web repo `.gitignore` excludes `mobile-app/` and `recovery/` directories.

---

## Environment Variables (Backend)
| Variable | Purpose |
|----------|---------|
| `MONGODB_URI` | MongoDB connection string |
| `SESSION_SECRET` | Express session secret |
| `RESEND_API_KEY` | Resend email API key |
| `NOTIFY_EMAIL` | Semicolon-separated list of notification recipients |
| `BASE_URL` | Base URL for the app (used for CORS) |
