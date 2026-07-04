# CatatBoros Wiki

Welcome to CatatBoros, money journal for people who want budgets with less spreadsheet sadness.

## Quick start

1. Install dependencies.

   ```bash
   npm install
   ```

2. Create `.env` from `.env.example`.

   ```bash
   copy .env.example .env
   ```

3. Build CSS.

   ```bash
   npm run build:css
   ```

4. Start app.

   ```bash
   npm run dev
   ```

5. Open `http://localhost:3000`.

## Main concepts

### Transactions

Transactions are daily spending logs. Each transaction stores date, category, pocket, note, payer, amount, and budget month/year.

### Pockets

Pockets are budget sources. Single-pocket transactions spend from one pocket. Multi-pocket transactions split one expense across up to 3 pockets.

### Monthly story

Monthly Story is the dashboard: total spending, category breakdown, payer breakdown, budget alerts, recent transactions, and month comparison.

### Budget close

Closing a month locks it from new transactions. Reopen month when correction is needed.

## Common tasks

### Add spending

Go to Log Spending, choose category and pocket, enter amount and note, then save. Confetti means wallet goblin has been recorded.

### Split spending across pockets

Use multi-pocket mode, pick up to 3 pockets, and make sure split total equals transaction amount.

### Review history

Open Review History, then filter by month, category, or pocket.

### Set budgets

Open Check Pockets, choose month, enter pocket budgets, and save.

### Close month

Open Check Pockets and close month after review. Closed months reject new transactions.

## Environment variables

| Name | Required | Purpose |
|---|---:|---|
| `MONGODB_URI` | Yes | MongoDB connection string |
| `SESSION_SECRET` | Yes | Express session signing secret |
| `PORT` | No | Local server port |
| `NODE_ENV` | No | Enables secure cookies in production |
| `RESEND_API_KEY` | No | Email notification API key |
| `NOTIFY_EMAIL` | No | Semicolon-separated recipient list |
| `BASE_URL` | No | App base URL |

## Deploy to Vercel

1. Push to GitHub.
2. Connect repository to Vercel.
3. Add production environment variables.
4. Deploy.

Vercel uses `vercel.json`, runs `npm run build:css`, and serves `app.js`.

## Troubleshooting

### `SESSION_SECRET is not defined`

Add `SESSION_SECRET` to `.env` or Vercel environment variables.

### `MONGODB_URI is not defined`

Add MongoDB connection string to `.env` or Vercel environment variables.

### Login works locally but not production

Check `NODE_ENV=production`, HTTPS, session store, and `MONGODB_URI`.

### CSS looks stale

Run:

```bash
npm run build:css
```

## Maintenance checklist

- Run `npm run build:css` before deploy.
- Keep `.env` secrets out of git.
- Check budget close behavior before month-end.
- Escape user text in notification HTML before exposing email to wider users.
- Add real tests when transaction editing or auth rules change.
