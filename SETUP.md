# FVG Trader — Setup & Deployment Guide

## What you need to sign up for (all free tiers)

### 1. OANDA Demo Account ← Start here
1. Go to **https://www.oanda.com/au-en/trading/demo-account/** and sign up
2. Once logged in, go to **My Account → Manage API Access**
3. Generate an API token — copy it immediately (only shown once)
4. Copy your **Account ID** (shown on the dashboard, format: `xxx-xxx-xxxxxxx-xxx`)
5. Paste both into `backend/.env`:
   ```
   OANDA_API_KEY=your-token-here
   OANDA_ACCOUNT_ID=your-account-id
   OANDA_ENVIRONMENT=practice
   ```

### 2. Railway (backend hosting) — ~$5/month
1. Go to **https://railway.app** → sign up with GitHub
2. Click **New Project → Deploy from GitHub repo**
3. Select your repo, set the root directory to `backend/`
4. Add environment variables (from your `.env`) in the Railway dashboard
5. Railway auto-detects `railway.toml` and deploys automatically
6. Copy the public URL (e.g. `https://your-app.railway.app`) for the frontend

### 3. Supabase (optional — for persistent signal/trade history)
- Currently the backend stores signals in memory (resets on restart)
- If you want persistence: go to **https://supabase.com**, create a project
- Copy the project URL and service role key into `.env`

### 4. Vercel (frontend hosting — free)
You likely already have this from Gloë. Just:
1. Push the `frontend/` folder to GitHub
2. Import the repo in Vercel → set root directory to `frontend/`
3. Add environment variable: `VITE_API_URL=https://your-app.railway.app`
4. Deploy

---

## Running locally (dev)

### Backend
```bash
cd backend
python -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env       # fill in OANDA credentials
uvicorn app.main:app --reload --port 8000
```
API docs at: http://localhost:8000/docs

### Frontend
```bash
cd frontend
npm install
npm run dev
```
App at: http://localhost:5173

The Vite dev server automatically proxies `/api` to `localhost:8000`,
so no CORS config needed in development.

---

## Project structure

```
FVG Trading/
├── backend/
│   ├── app/
│   │   ├── main.py              # FastAPI app entry point
│   │   ├── core/config.py       # Settings (loaded from .env)
│   │   ├── models/schemas.py    # All Pydantic data models
│   │   ├── services/
│   │   │   ├── oanda.py         # OANDA v20 API adapter
│   │   │   ├── strategy.py      # FVG + OB detection + backtester
│   │   │   └── scanner.py       # Live scanner (APScheduler)
│   │   └── routers/api.py       # All HTTP endpoints
│   ├── requirements.txt
│   ├── railway.toml             # Railway deploy config
│   └── .env.example
└── frontend/
    ├── src/
    │   ├── api/client.js        # All API calls in one place
    │   ├── components/Layout.jsx # Sidebar nav
    │   └── pages/
    │       ├── Dashboard.jsx    # Live positions, signals, scanner control
    │       ├── ChartView.jsx    # Candlestick chart with FVG/OB overlays
    │       ├── Backtest.jsx     # Backtest runner + results
    │       └── Config.jsx       # Strategy params + scanner config
    ├── package.json
    ├── vite.config.js
    └── .env.example
```

---

## API endpoints quick reference

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/v1/health` | Connection check |
| GET | `/api/v1/instruments` | All supported symbols |
| GET | `/api/v1/account` | Balance, NAV, trade count |
| GET | `/api/v1/account/positions` | Open positions |
| GET | `/api/v1/candles/{instrument}` | OHLCV data for charting |
| POST | `/api/v1/analyze/{instrument}` | FVG zones for chart overlay |
| POST | `/api/v1/backtest` | Full backtest with stats |
| POST | `/api/v1/orders` | Place bracket order |
| PUT | `/api/v1/scanner/config` | Configure + start/stop scanner |
| GET | `/api/v1/scanner/signals` | Live signal feed |

---

## What's next (Phase 3 nice-to-haves)

- [ ] Email alerts via Resend when a signal fires
- [ ] Multi-timeframe view (scan H1, confirm on M15)
- [ ] Paper vs Live toggle with a prominent warning
- [ ] Trade journal with notes per trade
- [ ] Supabase integration for persistent trade history + P&L tracking
