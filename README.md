# CatatBoros

Track spending before spending tracks you.

CatatBoros is a small, punchy money journal for daily expenses, monthly pocket budgets, and honest budget reality checks. It uses streaks, confetti, alerts, and charts so budgeting feels less like homework and more like keeping your wallet from becoming a goblin cave.

## What it does

- Log daily spending with category, pocket, payer, note, and date.
- Split one transaction across up to 3 pockets.
- Set monthly budgets per pocket.
- Close or reopen a month when budget review is done.
- Review spending history with month, type, and pocket filters.
- See monthly story cards, charts, recent transactions, and budget alerts.
- Send spending notifications by email with Resend.
- Works as a web app and installs like a PWA.

## Tech stack

- Node.js
- Express
- MongoDB + Mongoose
- Handlebars
- Tailwind CSS
- Vanilla JavaScript
- Resend
- Vercel

## Local setup

```bash
npm install
copy .env.example .env
npm run build:css
npm run dev
```

Required `.env` values:

```env
MONGODB_URI=mongodb://localhost:27017/moneyjournal
SESSION_SECRET=change_me
PORT=3000
NODE_ENV=development
```

Optional email values:

```env
RESEND_API_KEY=your_resend_api_key
NOTIFY_EMAIL=email1@example.com;email2@example.com
BASE_URL=http://localhost:3000
```

Open `http://localhost:3000`.

## Scripts

```bash
npm run dev        # start server
npm start          # start server
npm run build:css  # build Tailwind CSS
npm run dev:css    # watch Tailwind CSS
```

## Project map

| Path | Purpose |
|---|---|
| `app.js` | Express app, sessions, routes, HBS helpers |
| `database.js` | MongoDB connection |
| `controllers/` | Auth, budget, transaction logic |
| `routes/` | Express route definitions |
| `models/` | Mongoose schemas |
| `views/` | Handlebars pages and partials |
| `public/` | CSS, JS, images, manifest |
| `services/` | Transaction summary helpers |
| `utils/` | Constants and formatters |

## Deploy

Vercel builds CSS with `npm run build:css` and serves `app.js` through `@vercel/node`.

Set production environment variables in Vercel:

```env
MONGODB_URI=...
SESSION_SECRET=...
NODE_ENV=production
RESEND_API_KEY=...
NOTIFY_EMAIL=...
BASE_URL=...
```

## Code review notes

- `controllers/transactionController.js` builds email HTML from user input; escape `type`, `ngapain`, and username before sending HTML.
- `controllers/transactionController.js` validates multi-pocket amounts but does not reject invalid top-level `amount`, `date`, or single-pocket values early.
- `controllers/authController.js` lets profile updates change username without duplicate checks.
- `package.json` has no real test/lint script yet; add smoke tests before bigger refactors.

## License

Private project unless owner says otherwise.
