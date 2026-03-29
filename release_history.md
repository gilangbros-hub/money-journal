# Release History — Money Journal

> This file is updated with every commit. It tracks the full development timeline.

---

## Web App (`gilangbros-hub/money-journal`)

| # | Hash | Description |
|---|------|-------------|
| 1 | `f59f7a0` | Initial commit - Money Journal App |
| 2 | `a5e3614` | Add root route redirect to login |
| 3 | `2e898d7` | Add root route redirect v2 |
| 4 | `6dda2ee` | Redesign UI to clean finance app style |
| 5 | `753fcc2` | Round header card corners |
| 6 | `aec344b` | Add bottom toast response on transaction submit |
| 7 | `746db9a` | Fix responsive layout - proper mobile auto-adjust |
| 8 | `ea62ff7` | Fix amount input field visibility |
| 9 | `3fc0a47` | Fix amount input field visibility |
| 10 | `2437ff3` | Remove Rp prefix from amount input |
| 11 | `a46b99b` | REMOVE Rp prefix completely |
| 12 | `3c74583` | Implement WhatsApp notification for transactions |
| 13 | `4eacf43` | Optimize UI with Material Design 3 and prepare for Render deployment |
| 14 | `4e64b09` | Refactor to MVC pattern, improve schema, and enhance error handling |
| 15 | `4f9590b` | Redesign Input Menu: Modern, compact, emoji-based UI with new fields |
| 16 | `99675ad` | Add welcome buffer page and custom 'Makaci' toast notification |
| 17 | `1b8989c` | Fix login loop: Enable trust proxy for secure session cookies on Render |
| 18 | `c3c77eb` | Fix production sessions (connect-mongo) and polish UI spacing |
| 19 | `4eac523` | Fix MongoStore.create error by downgrading connect-mongo to stable v4.6.0 |
| 20 | `a5a168d` | Add Railway configuration for deployment |
| 21 | `919b1f3` | Redesign history page with dynamic Chart.js insights and modern UI |
| 22 | `fd7bfc4` | Fix filter overlap and add profile page with avatar selection |
| 23 | `206bdfd` | Add automated email notifications for transactions via Resend |
| 24 | `c17cd4f` | Remove WhatsApp auto-open feature |
| 25 | `4ea1d3e` | Handle default export for connect-mongo to fix runtime error |
| 26 | `96db0b8` | Fix Resend multi-recipient validation error by using array format |
| 27 | `e25c0f7` | Send emails individually to bypass Resend sandbox restriction |
| 28 | `cb46b06` | Add percentage labels to history pie chart using chartjs-plugin-datalabels |
| 29 | `eff86ae` | Add Export to Excel (CSV) feature on history page |
| 30 | `88beb86` | Refactor enums, improve security and validation |
| 31 | `37b71c0` | Redesign dashboard layout and add category visualization |
| 32 | `e090e85` | Configure Vercel deployment and update theme |
| 33 | `c143589` | Fix Vercel 500: update path resolution and build config |
| 34 | `6ae3510` | Update branding with new logo |
| 35 | `e9f3d84` | Add PWA manifest and app icons |
| 36 | `ee973ec` | Refactor: Add currency util, aggregation service, and dashboard API |
| 37 | `3f0e3bf` | Fix: Move requires to top and fix function syntax in transactionController |
| 38 | `c1e3f23` | Feat: Connect frontend to dashboard API and add category filtering |
| 39 | `df82951` | Feat: Add role-based tracking (Husband/Wife) and dashboard pie chart |
| 40 | `4386f6d` | Fix: Revert to lowercase user import to match file system |
| 41 | `19275a1` | Fix: Add debugging and robustness to frontend transaction rendering |
| 42 | `3bdd4dc` | Fix: Add ID to transactions header to resolve frontend DOM error |
| 43 | `c05f306` | Feat: Add 'Show All' button to category filter list |
| 44 | `c85a28e` | Refactor: cleanup junk files, optimize CSS, create shared utilities |
| 45 | `425913e` | Feat: add Pocket Budget feature with role-based permissions and navigation taskbar |
| 46 | `4b83bd2` | Style: unify page headers and design language to match budget page |
| 47 | `e3998a3` | Feat: add monthly comparison and low budget alerts to dashboard |
| 48 | `cf03cce` | Fix: position submit button above navbar |
| 49 | `473c38a` | Fix: make date picker full width like other inputs |
| 50 | `258bcab` | Feat: add enhanced budget tracking with health summary and progress bars |
| 51 | `4dceefd` | Style: make submit button floating and responsive |
| 52 | `b8931a5` | Feat: replace budget alerts with category spending pie chart |
| 53 | `3cfcac3` | Fix: use correct API field names for pie chart |
| 54 | `8de9abc` | QOL: B&W redesign, Apple HIG, gamification, budget pie chart, fix submit button border |
| 55 | `9384077` | Feat: distinct auto-assigned colors for each pocket in budget pie chart |
| 56 | `b80b8ce` | Feat: redesign login/register pages with dark navy header + white card layout |
| 57 | `27425e4` | Feat: add missing pockets and user isActive flag |
| 58 | `9dd3ea2` | Fix: update hardcoded pocket sources in transaction form |
| 59 | `3a165a7` | Docs: add CHANGELOG.md documenting all commits |
| 60 | `5761b47` | Style: redesign dashboard from B&W to vibrant colorful theme |
| 61 | `0fe7811` | Style: unify colorful design language across all pages |
| 62 | `269c44c` | Fix: resolve line-break bug in transaction form pocket/type values |
| 63 | `efa7bb7` | Docs: update CHANGELOG with recent changes |
| 64 | `932ddbb` | Fix(transaction): prevent prettier from wrapping pocket and type select values |
| 65 | `47bda17` | Fix(hbs): robust split helper trims spaces and newlines |
| 66 | `33b1b6a` | Feat: add budget month picker to transaction form with data migration script |
| 67 | `9cd38a5` | Feat: add temporary migration endpoint for budget month |
| 68 | `527bbad` | Chore: remove temporary migration endpoint |
| 69 | `7ee4cc4` | Fix: dashboard and transaction list filter by budgetMonth instead of calendar date |
| 70 | `c7a92b6` | Feat: add mobile API auth endpoints |
| 71 | `032beed` | Feat: Add View All Transactions feature |
| 72 | `d6be859` | Feat: migrate to Tailwind CSS with Tropis Neon dark theme |
| 73 | `54f361e` | Style: redesign auth pages and fix taskbar overlapping |
| 74 | `27b7f29` | Chore: ignore mobile app and recovery artifacts |
| 75 | `a28d52a` | Matched all mobile screens with the web app reference |
| 76 | `87af598` | Feat: close/reopen budget, success modal, closed pocket validation |
| 77 | `1703a45` | Fix: rework close budget to close entire month, not per-pocket |
| 78 | `7bc8281` | Feat: add pocket (budget type) filter to All Transactions web page |

---

## Mobile App (`gilangbros-hub/money-journal-mobile`)

| # | Hash | Description |
|---|------|-------------|
| 1 | `28e26e0` | chore(phase-1): initial native expo setup with nativewind and auth screens |
| 2 | `6eccc52` | feat(phase-2): finish native dashboard screen with gifted charts and tab navigator |
| 3 | `d35ab44` | feat(phase-3): add and view all transaction forms |
| 4 | `63fdda1` | feat(phase-4): implement budget charting and profile logout screens |
| 5 | `4bf0b27` | chore(phase-5): configure eas for apk build |
| 6 | `88dd344` | fix: add babel-preset-expo and downgrade nativewind to v2 for EAS compatibility |
| 7 | `06864d2` | Fix AddTransaction layout: consistent 3-col grids, reorder fields, natural spacing |
| 8 | `d958bc7` | UI polish: FAB button, tab bar spacing, pie chart fix, floating save |
| 9 | `0d3b113` | feat: close/reopen budget, success modal, View All fix, FAB hidden on Add screen |
| 10 | `6a8d201` | fix: rework close budget to month-level, closed months disabled in budget picker |
| 11 | `ed52ff8` | feat: add pocket (budget type) filter to AllTransactionsScreen |
| 12 | `06b48ef` | fix: FAB to bottom-right, save button inline in scroll view |
| 13 | `3b4acb0` | fix: FAB truly floating bottom-right with glow, larger size |

---

> **Note**: Update this file with every new commit to maintain a clear development trail.
