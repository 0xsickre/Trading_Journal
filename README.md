# ICT Trading Journal

A professional ICT (Inner Circle Trader) trade journal web app: log executions, review performance, import broker exports, and analyse your own trading statistics. Single user by design, multi-tenant safe by construction — every table is protected by Postgres Row Level Security.

**Makro bias / COT / nedeljni plan** žive u Trading data vault-u i trading-dashboard-u (F0–F4). TA plan za F5 ide u Notion (kasnije) — ovaj repo je **samo journal + PnL**.

---

## Feature Overview

| Area | What it does |
|---|---|
| Dashboard | 12 performance stat cards, equity curve, R-distribution, calendar heatmap, tag breakdowns |
| Journal | Sortable/filterable trade grid with CSV + Excel export |
| New Trade | 49-field ICT trade form with partial-exit fills and a position-size calculator |
| Import | CSV/Excel broker import with column mapping and per-row reconciliation |
| Settings | In-app CRUD for dropdown lists, instruments, and accounts |

---

## Features

### Trade Logging
- **49-field trade form** across four sections: Context, ICT Setup & Analysis, Risk & Execution, and Psychology & Review.
- **Partial exit / scale-out support** — one parent position with multiple execution fills; accurate weighted R-multiple across every exit.
- **Gross vs Net P/L** separation — raw price movement vs. P/L after fees and swap/funding.
- **TradingView chart URL** stored per trade as a clickable link.
- **Screenshot uploads** — before/after chart images via Supabase Storage.
- **Position-size calculator** — risk % × account balance ÷ stop distance × point value.
- **HTF Bias / Bias TF** — per-trade ICT context fields (not a separate macro module).

### Dropdowns — Fully Editable In-App
- **34 dropdown lists / ~296 default options** seeded per user for the trade form.
- **+ Add** inline on every dropdown; **Settings → Lists** for full CRUD, reorder, and colour, organised by category (Context, ICT Setup, Risk, Psychology).
- **Soft-delete** — archiving an option hides it from entry forms but keeps historical trades intact and filterable.

### Journal Grid
- TanStack Table with sort, search, and per-column filters (instrument, direction, grade, session, model, result, status).
- Columns: trade #, date (account timezone), instrument, direction, grade, size, avg entry, avg exit, R, Gross P/L, Net P/L, status, TradingView link.
- One-click CSV and Excel export of the current filtered view.

### Analytics Dashboard
- **12 stat cards** — Total Trades, Win Rate, Total R, Avg R, Profit Factor, Expectancy (R), Best / Worst trade, Win / Loss streak, Max Drawdown.
- **Equity curve** — Gross ↔ Net toggle, $ or R metric, cumulative from account starting balance.
- **R-distribution histogram** — colour-coded bars from `<−3R` to `>5R`.
- **Calendar heatmap** — 26-week daily P/L in account timezone.
- **Breakdown table** — win rate, total R, avg R, net P/L grouped by any tag (setup grade, session, entry model, emotion, mistake, instrument, …).
- Account and date-range filters throughout.

### Import & Reconciliation
- Upload a CSV or Excel broker export.
- Column-mapping UI with auto-detect and saveable broker presets (`tj_column_mappings`).
- Smart per-row reconciliation: **Create / Merge / Skip**.
  - Merge updates only objective fields (price, qty, fee, swap) — psychology, ICT model, and notes are never overwritten.
  - Full diff highlighting of changed values.
- Raw import rows stored for an audit trail.

### Instruments & Accounts
- **9-symbol watchlist** — `DXY`, `EURUSD`, `GBPUSD`, `USDJPY`, `GBPJPY`, `EURJPY`, `NAS100USD`, `SPX500USD`, `XAUUSD` — seeded automatically on signup and enforced across the app.
- Per-instrument `point_value` for accurate P/L across asset classes (editable in Settings).
- Multiple accounts with individual currency, starting balance, and **IANA timezone** — all timestamps display in the account's local time regardless of the user's machine.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router, Server Actions, TypeScript) |
| Styling | Tailwind CSS v4 + shadcn/ui (Radix / new-york variant) |
| Database | Supabase Postgres with Row Level Security |
| Auth | Supabase Auth via `@supabase/ssr` |
| Storage | Supabase Storage (trade screenshot bucket) |
| Table | TanStack Table v8 |
| Charts | Recharts v3 |
| Forms | react-hook-form + Zod |
| Import/Export | PapaParse (CSV) + SheetJS/xlsx (Excel) |
| Time | date-fns / date-fns-tz |
| Testing | Vitest |

---

## Data Model

```
tj_accounts          – broker accounts (currency, balance, IANA timezone)
tj_instruments       – tradeable symbols with point_value per asset class (9-symbol watchlist)
tj_option_lists      – 34 dropdown list definitions (Context, ICT Setup, Risk, Psychology)
tj_option_items      – ~296 default options (soft-deleteable)

tj_positions         – parent trade record (49 fields: context, ICT setup, risk plan, psychology)
tj_executions        – child fills (entry or exit, price, qty, fee, swap, timestamp UTC)
tj_position_stats    – SQL view: avg_entry, avg_exit, entry_qty, gross_pl, net_pl, realized_r

tj_trade_images      – screenshot storage references
tj_import_batches    – import session metadata
tj_import_rows       – per-row import audit (raw + parsed + match status)
tj_column_mappings   – saved broker column-mapping presets
```

- All timestamps are stored as `timestamptz` (UTC). Display and import parsing convert to the per-account IANA timezone via `date-fns-tz`.
- Dropdown values are stored as plain text, so archiving an option never corrupts historical data.

---

## Getting Started

### Prerequisites
- Node.js 20+
- A [Supabase](https://supabase.com) project (free tier is sufficient)

### Local Setup

```bash
git clone https://github.com/0xsickre/Trading_Journal.git
cd Trading_Journal
npm install
```

Create `.env.local` in the project root:

```env
NEXT_PUBLIC_SUPABASE_URL=https://<your-project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<your-anon-public-key>
```

Both values are in **Supabase Dashboard → Project Settings → API**.

```bash
npm run dev
# http://localhost:3000
```

### Database Setup

Apply migrations via the Supabase CLI (`supabase db push`) or the SQL editor. The repo includes `supabase/migrations/` — run all files in order, including `20260719120000_drop_analysis_module.sql` if upgrading from an older schema that had Market Analysis tables.

New signups are seeded automatically by the auth trigger; `tj_seed_my_defaults` is also called on login as an idempotent fallback (`src/lib/journal/ensure-defaults.ts`).

After applying migrations, create your user in **Supabase Dashboard → Authentication → Users** (or via the sign-up form). For personal use, disable email confirmation under **Authentication → Providers → Email**.

---

## Testing

```bash
npm run test         # run the Vitest suite once
npm run test:watch   # watch mode
```

---

## Deployment (Vercel)

1. Push to GitHub and import the repository at [vercel.com/new](https://vercel.com/new).
2. In **Vercel → Settings → Environment Variables** add both `Production` and `Preview`:
   ```
   NEXT_PUBLIC_SUPABASE_URL      = https://<ref>.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY = <anon key>
   ```
3. In **Supabase → Authentication → URL Configuration** set:
   - **Site URL**: `https://<your-vercel-domain>.vercel.app`
   - **Redirect URLs**: `https://<your-vercel-domain>.vercel.app/**`
4. Redeploy.

> **Recommended:** After creating your account, disable public sign-up — **Supabase → Authentication → Providers → Email → uncheck "Allow new users to sign up"**. This prevents anyone else from registering while keeping your account fully functional.

---

## Security

- **Row Level Security** is enabled on every `tj_*` table (`user_id = auth.uid()`). Even if another user registered, they could not read or write any other user's data.
- The `service_role` key is never referenced in frontend code — only the `anon` publishable key is exposed.
- Internal seed functions (`tj_seed_defaults`, `tj_on_auth_user_created`) are revoked from `anon` and `authenticated` roles.
- All authentication is handled by Supabase Auth (bcrypt, JWT, optional MFA available).

---

## Project Structure

```
src/
├── app/
│   ├── (app)/                 # Protected routes (auth-checked layout)
│   │   ├── page.tsx           # Dashboard
│   │   ├── journal/           # Journal grid
│   │   ├── trades/            # New / edit trade
│   │   ├── import/            # CSV/Excel import wizard
│   │   └── settings/          # Lists, instruments, accounts
│   ├── login/                 # Auth page
│   └── globals.css            # Tailwind v4 theme (dark by default)
├── components/
│   ├── journal/               # Feature components (form, grid, dashboard, heatmap, …)
│   └── ui/                    # shadcn/ui primitives
├── lib/
│   ├── supabase/              # Client, server, proxy helpers + generated TS types
│   └── journal/               # Business logic
│       ├── analytics.ts       # Dashboard stats, equity curve, breakdowns
│       ├── trades.ts          # Trade/position queries
│       ├── form-config.ts     # Declarative 49-field trade form
│       ├── options.ts / accounts.ts / instruments.ts / time.ts / format.ts / nav.ts
│       └── ensure-defaults.ts # Idempotent per-user seeding fallback
└── proxy.ts                   # Next.js 16 session proxy (replaces middleware.ts)
```

---

## License

Private — personal use only.
