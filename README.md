# Money Journal (CatatBoros)

Money Journal is a full-stack personal finance application designed for seamless daily expense tracking and monthly budget management. It features a modern "Tropis Neon" dark theme on the web and a clean, light minimalist card design on its native mobile app.

## Key Features
- **Transaction Tracking**: Log daily expenses with precise categories and pockets.
- **Multi-Pocket Support**: Split a single transaction across up to 3 source pockets.
- **Budget Management**: Set and track monthly budgets per pocket with a month-level close/reopen feature.
- **Interactive Dashboard**: View real-time spending summaries, pie charts, and monthly comparisons.
- **Gamification**: Built-in streaks, success confetti, and motivational messages to encourage consistency.
- **Export Options**: Export transaction history to CSV/Excel.
- **Email Notifications**: Real-time spending alerts via Resend.

## Tech Stack
- **Backend**: Node.js, Express, MongoDB, Mongoose
- **Frontend (Web)**: Handlebars (HBS), Tailwind CSS, Vanilla JS, Chart.js
- **Mobile App**: React Native (Expo)
- **Deployment**: Vercel (Web), EAS (Mobile)

## Setup Instructions

1. Clone the repository:
   ```bash
   git clone https://github.com/gilangbros-hub/money-journal.git
   cd money-journal
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Set up environment variables (create a `.env` file based on `.env.example`):
   ```env
   MONGODB_URI=your_mongodb_connection_string
   SESSION_SECRET=your_secret_key
   RESEND_API_KEY=your_resend_api_key
   NOTIFY_EMAIL=email1@example.com;email2@example.com
   BASE_URL=http://localhost:3000
   ```

4. Run the development server:
   ```bash
   npm run dev
   ```

5. (Optional) Run the Tailwind CSS watcher:
   ```bash
   npm run dev:css
   ```
