# Changelog

All notable changes to the **Money Journal** app are documented here, from the first commit to the latest.

---

## [2026-03-01]

### Fixed
- Transaction form submission error caused by line-break characters in pocket/type values (`Weekend\nTransport`, `Uang\nSampah`)
- Added defensive `.trim()` on type and pocket fields in transaction controller

### Commits
| Hash | Description |
|------|-------------|
| `269c44c` | fix: resolve line-break bug in transaction form pocket/type values |

---

## [2026-02-25]

### Added
- `Bandung` and `Sedeqah` pocket sources
- `isActive` flag on user registration — new accounts must be manually activated in MongoDB before login
- `CHANGELOG.md` documenting all commits from first to latest

### Changed
- Redesigned dashboard from B&W to vibrant colorful theme (coral-to-violet gradient)
- Unified colorful design language across all pages (login, register, transaction, budget, navbar)

### Fixed
- Hardcoded pocket sources in the transaction form template now reflect the updated list

### Commits
| Hash | Description |
|------|-------------|
| `0fe7811` | style: unify colorful design language across all pages |
| `5761b47` | style: redesign dashboard from B&W to vibrant colorful theme |
| `3a165a7` | docs: add CHANGELOG.md documenting all commits |
| `9dd3ea2` | fix: update hardcoded pocket sources in transaction form |
| `27425e4` | feat: add missing pockets and user isActive flag |

---

## [2026-02-20]

### Added
- Redesigned login/register pages with dark navy header + white card layout
- Distinct auto-assigned colors for each pocket in budget pie chart

### Changed
- Major QOL redesign: B&W theme, Apple HIG inspiration, gamification, budget pie chart, fixed submit button border

### Commits
| Hash | Description |
|------|-------------|
| `b80b8ce` | feat: redesign login/register pages with dark navy header + white card layout |
| `9384077` | feat: distinct auto-assigned colors for each pocket in budget pie chart |
| `8de9abc` | QOL: B&W redesign, Apple HIG, gamification, budget pie chart, fix submit button border |

---

## [2026-02-09]

### Added
- Enhanced budget tracking with health summary and progress bars
- Category spending pie chart replacing budget alerts

### Fixed
- Submit button positioned above navbar
- Date picker made full width like other inputs
- Correct API field names for pie chart

### Changed
- Submit button made floating and responsive

### Commits
| Hash | Description |
|------|-------------|
| `3cfcac3` | fix: use correct API field names for pie chart |
| `b8931a5` | feat: replace budget alerts with category spending pie chart |
| `4dceefd` | style: make submit button floating and responsive |
| `258bcab` | feat: add enhanced budget tracking with health summary and progress bars |
| `473c38a` | fix: make date picker full width like other inputs |
| `cf03cce` | fix: position submit button above navbar |

---

## [2026-02-08]

### Added
- Material Design 3 UI optimization for Render deployment
- MVC architecture refactoring with improved schema and error handling
- Modern, compact, emoji-based input menu redesign
- Welcome buffer page and custom "Makaci" toast notification
- History page redesign with dynamic Chart.js insights
- Profile page with avatar selection
- Automated email notifications via Resend
- Percentage labels on history pie chart
- Export to Excel (CSV) feature on history page
- Dashboard layout with category visualization
- PWA manifest and app icons
- Currency utility, aggregation service, and dashboard API
- Category filtering on frontend
- Role-based tracking (Husband/Wife) and dashboard pie chart
- "Show All" button for category filter
- Pocket Budget feature with role-based permissions and navigation taskbar
- Monthly comparison and low budget alerts on dashboard

### Fixed
- Login loop: enabled trust proxy for secure session cookies on Render
- Production sessions with connect-mongo
- MongoStore.create error by downgrading connect-mongo to v4.6.0
- Resend multi-recipient validation error
- Frontend transaction rendering robustness and debugging
- DOM error with transactions header ID
- Vercel 500 error: path resolution and build config
- Function syntax in transactionController

### Changed
- Unified page headers and design language to match budget page
- Removed WhatsApp auto-open feature
- Cleaned up junk files, optimized CSS, created shared utilities
- Updated branding with new logo
- Enum refactoring, improved security and validation
- Configured Vercel deployment and updated theme
- Railway configuration for deployment
- Emails sent individually to bypass Resend sandbox restriction

### Commits
| Hash | Description |
|------|-------------|
| `e3998a3` | feat: add monthly comparison and low budget alerts to dashboard |
| `4b83bd2` | style: unify page headers and design language to match budget page |
| `425913e` | feat: add Pocket Budget feature with role-based permissions and navigation taskbar |
| `c85a28e` | refactor: cleanup junk files, optimize CSS, create shared utilities |
| `c05f306` | feat: add "Show All" button to category filter list |
| `3bdd4dc` | fix: add ID to transactions header to resolve frontend DOM error |
| `19275a1` | fix: add debugging and robustness to frontend transaction rendering |
| `4386f6d` | fix: revert to lowercase user import to match file system |
| `df82951` | feat: add role-based tracking (Husband/Wife) and dashboard pie chart |
| `c1e3f23` | feat: connect frontend to dashboard API and add category filtering |
| `3f0e3bf` | fix: move requires to top and fix function syntax in transactionController |
| `ee973ec` | refactor: add currency util, aggregation service, and dashboard API |
| `e9f3d84` | feat: add PWA manifest and app icons |
| `6ae3510` | update branding with new logo |
| `c143589` | fix: Vercel 500 — update path resolution and build config |
| `e090e85` | configure Vercel deployment and update theme |
| `37b71c0` | redesign dashboard layout and add category visualization |
| `88beb86` | refactor enums, improve security and validation |
| `eff86ae` | feat: add Export to Excel (CSV) feature on history page |
| `cb46b06` | feat: add percentage labels to history pie chart |
| `e25c0f7` | send emails individually to bypass Resend sandbox restriction |
| `96db0b8` | fix: Resend multi-recipient validation error |
| `4ea1d3e` | handle default export for connect-mongo |
| `c17cd4f` | remove WhatsApp auto-open feature |
| `206bdfd` | feat: add automated email notifications via Resend |
| `fd7bfc4` | fix: filter overlap and add profile page with avatar selection |
| `919b1f3` | redesign history page with dynamic Chart.js insights and modern UI |
| `a5a168d` | add Railway configuration for deployment |
| `4eac523` | fix: MongoStore.create error by downgrading connect-mongo to v4.6.0 |
| `c3c77eb` | fix: production sessions (connect-mongo) and polish UI spacing |
| `1b8989c` | fix: login loop — enable trust proxy for secure session cookies on Render |
| `99675ad` | feat: add welcome buffer page and custom "Makaci" toast notification |
| `4f9590b` | redesign Input Menu: modern, compact, emoji-based UI with new fields |
| `4e64b09` | refactor to MVC pattern, improve schema, and enhance error handling |
| `4eacf43` | optimize UI with Material Design 3 and prepare for Render deployment |

---

## [2026-01-12]

### Added
- WhatsApp notification for transactions

### Commits
| Hash | Description |
|------|-------------|
| `3c74583` | implement WhatsApp notification for transactions |

---

## [2026-01-11]

### Added
- Initial release of Money Journal App
- Root route redirect to login
- Bottom toast response on transaction submit

### Changed
- Redesigned UI to clean finance app style
- Rounded header card corners

### Fixed
- Responsive layout for proper mobile auto-adjust
- Amount input field visibility (multiple iterations)
- Removed Rp prefix from amount input

### Commits
| Hash | Description |
|------|-------------|
| `a46b99b` | REMOVE Rp prefix completely |
| `2437ff3` | remove Rp prefix from amount input |
| `3fc0a47` | fix: amount input field visibility |
| `ea62ff7` | fix: amount input field visibility |
| `746db9a` | fix: responsive layout — proper mobile auto-adjust |
| `aec344b` | add bottom toast response on transaction submit |
| `753fcc2` | round header card corners |
| `6dda2ee` | redesign UI to clean finance app style |
| `2e898d7` | add root route redirect v2 |
| `a5e3614` | add root route redirect to login |
| `f59f7a0` | Initial commit — Money Journal App |
