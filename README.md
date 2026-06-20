# ICT Trading Journal

A professional trade journaling web application built for ICT (Inner Circle Trader) methodology. Log, review, and analyse every trade with granular ICT-specific tagging, partial exit tracking, and statistics that go far beyond any spreadsheet.

---

## Features

### Trade Logging
- **49-field trade form** covering Context, ICT Setup & Analysis, Risk & Execution, and Psychology
- **Partial exit / scale-out support** — parent position + multiple execution fills; accurate weighted R-multiple across all exits
- **Gross vs Net P/L** separation — price movement vs. after fees and swap funding
- **TradingView chart URL** — clickable link per trade stored alongside all other fields
- **Screenshot uploads** — before/after chart images via Supabase Storage
- **Position-size calculator** — risk % × account balance ÷ stop distance × point value

### Dropdowns — Fully Editable In-App
- All 35 dropdown lists (306 default options) are managed inside the app — no code changes needed
- **+ Add** button inline on every dropdown; **Settings → Lists** for full CRUD + reorder + colour
- **Soft-delete**: archiving an option hides it from entry forms but keeps historical trades intact and filterable

### Journal Grid
- TanStack Table with sort, search, and per-column filters (instrument, direction, grade, session, model, result, status)
- Columns: trade #, date (account timezone), instrument, direction, grade, size, avg entry, avg exit, R, Gross P/L, Net P/L, status, TradingView link
- One-click CSV and Excel export of the current filtered view

### Analytics Dashboard
- **12 stat cards** — Total Trades, Win Rate, Total R, Avg R, Profit Factor, Expectancy (R), Best / Worst trade, Win / Loss streak, Max Drawdown
- **Equity curve** — Gross ↔ Net toggle, $ or R metric, cumulative from account starting balance
- **R-distribution histogram** — colour-coded bars from `<−3R` to `>5R`
- **Calendar heatmap** — 26-week daily P/L in account timezone
- **Breakdown table** — win rate, total R, avg R, net P/L grouped by any tag (setup grade, session, entry model, emotion, mistake, instrument, …)
- Account and date-range filters throughout

### Import & Reconciliation
- Upload CSV or Excel broker export
- Column mapping UI with auto-detect and saveable broker presets
- Smart reconciliation per row: **Create / Merge / Skip**
  - Merge updates only objective fields (price, qty, fee, swap) — psychology, ICT model, and notes are never overwritten
  - Full diff highlighting of changed values
- Raw import rows stored for audit trail

### Instruments & Accounts
- **60 pre-seeded instruments** across Futures & Micros, Index CFDs, FX Majors/Crosses, Crypto, and Top Stocks/ETFs — seeded automatically on signup
- Per-instrument `point_value` for accurate P/L across all asset classes (editable in Settings)
- Multiple accounts with individual currency, starting balance, and **IANA timezone** — all timestamps displayed in the account's local time regardless of the user's machine

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

---

## Data Model

```
tj_accounts          – broker accounts (currency, balance, IANA timezone)
tj_instruments       – tradeable symbols with point_value per asset class
tj_option_lists      – 35 dropdown list definitions
tj_option_items      – 306 default options (soft-deleteable)

tj_positions         – parent trade record (49 fields: context, ICT setup, risk plan, psychology)
tj_executions        – child fills (entry or exit, price, qty, fee, swap, timestamp UTC)
tj_position_stats    – SQL view: avg_entry, avg_exit, entry_qty, gross_pl, net_pl, realized_r

tj_trade_images      – screenshot storage references
tj_import_batches    – import session metadata
tj_import_rows       – per-row import audit (raw + parsed + match status)
```

All timestamps are stored as `timestamptz` (UTC). Display and import parsing convert to the per-account IANA timezone via `date-fns-tz`.

Dropdown values are stored as plain text in `tj_positions`, so archiving an option never corrupts historical data.

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

Apply the migrations in order via the Supabase SQL editor:

| Migration | Description |
|---|---|
| `tj_schema` | All tables, RLS policies, `tj_position_stats` view, Storage bucket |
| `tj_seed_function` | `public.tj_seed_defaults(uuid)` — 34 lists, 306 options, 60 instruments, 1 account |
| `tj_auth_seed_trigger` | `AFTER INSERT ON auth.users` trigger — seeds every new signup automatically |
| `tj_seed_harden_grants` | Revokes anon/authenticated from internal seed functions |

After applying migrations, create your user in **Supabase Dashboard → Authentication → Users** (or via the sign-up form). For personal use, disable email confirmation under **Authentication → Providers → Email**.

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

- **Row Level Security** is enabled on every `tj_*` table (`user_id = auth.uid()`). Even if another user were to register, they cannot read or write any other user's data.
- The `service_role` key is never referenced in frontend code — only the `anon` publishable key is exposed.
- Internal seed functions (`tj_seed_defaults`, `tj_on_auth_user_created`) are revoked from `anon` and `authenticated` roles.
- All authentication is handled by Supabase Auth (bcrypt, JWT, optional MFA available).

---

## Project Structure

```
src/
├── app/
│   ├── (app)/               # Protected routes (auth-checked layout)
│   │   ├── page.tsx         # Dashboard
│   │   ├── journal/         # Journal grid
│   │   ├── trades/          # New / edit trade
│   │   ├── import/          # CSV/Excel import wizard
│   │   └── settings/        # Lists, instruments, accounts
│   ├── login/               # Auth page
│   └── globals.css          # Tailwind v4 theme (dark by default)
├── components/
│   ├── journal/             # Feature components (form, grid, dashboard, heatmap, …)
│   └── ui/                  # shadcn/ui primitives
├── lib/
│   ├── supabase/            # Client, server, proxy helpers + generated TS types
│   └── journal/             # Business logic (analytics, time, format, options, trades)
└── proxy.ts                 # Next.js 16 session proxy (replaces middleware.ts)
```

---

## License

Private — personal use only.
