# Development Documentation

This document outlines the architecture, deployment workflows, and release history for the Money Journal app.

## Architecture & Key Files

### Backend
| File | Purpose |
|------|---------|
| `controllers/transactionController.js` | CRUD for transactions, dashboard summary, closed-month validation, multi-pocket validation |
| `controllers/budgetController.js` | Budget CRUD, month-level close/reopen, budget history, multi-pocket spending aggregation |
| `models/transaction.js` | Transaction schema (date, type, pocket, amount, budgetMonth, budgetYear, sourceType, sourceBreakdowns) |
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
| `public/js/transaction.js` | Add Transaction form logic, closed month check, multi-pocket source toggle and breakdown rows |
| `public/js/allTransactions.js` | All Transactions filtering (type + pocket), sorting, delete, multi-pocket badge display |
| `public/js/budget.js` | Budget rendering, month-level close/reopen toggle |
| `public/js/common.js` | Shared utilities (toast, menu toggle, formatters) |

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

## Deployment Workflow

### Web
1. Commit and push to `main` branch of `gilangbros-hub/money-journal`
2. Vercel auto-deploys from GitHub

### Mobile
1. Commit and push to `main` branch of `gilangbros-hub/money-journal-mobile`
2. OTA Update: `npx eas-cli update --branch main --environment production --message "description"`
3. APK Build: `npx eas-cli build -p android --profile preview --non-interactive`
4. Download APK from Expo Dashboard

---

## Known Issues / Potential Improvements
- OTA updates may not always apply immediately on older APK builds; user sometimes needs a new APK.
- The `cli.appVersionSource` field in `eas.json` should be configured per Expo's upcoming requirement.
- Expo package versions currently show minor SDK mismatch warnings in `expo-doctor`.
- No edit functionality for existing transactions in the mobile app (only delete).
- No dark/light mode toggle (web is dark-only, mobile is light-only).

---

## Release History

### Web App (`gilangbros-hub/money-journal`)
| # | Hash | Description |
|---|------|-------------|
| 75 | `a28d52a` | Matched all mobile screens with the web app reference |
| 76 | `87af598` | Feat: close/reopen budget, success modal, closed pocket validation |
| 77 | `1703a45` | Fix: rework close budget to close entire month, not per-pocket |
| 78 | `7bc8281` | Feat: add pocket (budget type) filter to All Transactions web page |
| 79 | `696ae3d` | Feat: add multi-pocket source for Add Transaction |

### Mobile App (`gilangbros-hub/money-journal-mobile`)
| # | Hash | Description |
|---|------|-------------|
| 16 | `f05a277` | feat: redesign mobile add transaction screen |
| 17 | `ff28208` | feat: refactor add transaction to card-centric flow |
| 18 | `a0e86f5` | style: unify mobile cards and floating nav polish |
| 19 | *(pending)* | style: overhaul mobile UI to clean light minimalist card design |
