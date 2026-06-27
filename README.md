# ICT Trading Journal

A professional trading journal and market-analysis web app built around the ICT (Inner Circle Trader) methodology. It combines two tightly integrated workspaces:

1. **Trade Journal** — log, review, and analyse every execution with granular ICT-specific tagging, partial-exit tracking, and statistics that go far beyond a spreadsheet.
2. **Market Analysis** — track your weekly directional bias per instrument, record the COT / macro / volatility context behind it once per week, close each call Win/Loss, and discover which factor combinations actually produce a high hit-rate.

Single user by design, multi-tenant safe by construction: every table is protected by Postgres Row Level Security.

---

## Feature Overview

| Area | What it does |
|---|---|
| Dashboard | 12 performance stat cards, equity curve, R-distribution, calendar heatmap, tag breakdowns |
| Journal | Sortable/filterable trade grid with CSV + Excel export |
| Analysis | Weekly bias tracking with scope-split data entry and combo win-rate analytics |
| New Trade | 49-field ICT trade form with partial-exit fills and a position-size calculator |
| Import | CSV/Excel broker import with column mapping and per-row reconciliation |
| Settings | In-app CRUD for all dropdown lists, instruments, and accounts |

---

## Features

### Trade Logging
- **49-field trade form** across four sections: Context, ICT Setup & Analysis, Risk & Execution, and Psychology & Review.
- **Partial exit / scale-out support** — one parent position with multiple execution fills; accurate weighted R-multiple across every exit.
- **Gross vs Net P/L** separation — raw price movement vs. P/L after fees and swap/funding.
- **TradingView chart URL** stored per trade as a clickable link.
- **Screenshot uploads** — before/after chart images via Supabase Storage.
- **Position-size calculator** — risk % × account balance ÷ stop distance × point value.

### Market Analysis (bias tracking)
A separate workspace for grading your *read of the market*, independent of individual trades and not tied to any account.

- **Weekly bias log** — pick an instrument, a direction (Bullish / Bearish / Neutral), a start date and a period in weeks; the app computes the end date and you later close it **Win** or **Loss** based on whether the bias was correct.
- **Scope-split data entry — "enter once, reuse"** — the 17 contextual factors live at their natural level so nothing is retyped:
  - **Global / weekly (8)** — `rates_regime`, `yield_curve`, `growth_bias`, `dxy_1m`, `vix_level`, `move_level`, `shield_active`, `dxy_trend`. Entered once per week, shared by all symbols.
  - **Per-currency / leg (5)** — `cot_idx_3y`, `cot_flow`, `seasonality`, `cot_timing`, `fx_policy_spread`. Entered once per underlying (EUR, USD, GBP, JPY, DXY, NDX, SPX, XAU) and reused by every pair that contains it.
  - **Pair-level (3)** — `cot_score`, `cot_verdict`, `cot_confidence`. Entered on the analysis for FX pairs; for single instruments all COT fields come directly from that instrument's leg card.
- **Week workspace** — a week picker plus a Global Context card and a per-currency/underlying COT grid, each field auto-saving with a "saved" indicator (last-write-wins upsert).
- **Inherited-data preview** — when drafting an analysis, the global + leg data that will attach for that week is shown read-only, so you never re-enter shared context.
- **Combo win-rate analytics** — "What works best": ranks combinations of 1–3 resolved factors (bias + COT/macro/vol) by win rate over closed analyses, filterable by instrument and combo size, with a configurable minimum-sample guard.
- **Breakdowns** — hit-rate by instrument and by bias direction, plus an expandable factor view per analysis.
- Time keying is by **ISO week (UTC Monday)** of the start date, so weekly context attaches deterministically regardless of machine timezone.

### Dropdowns — Fully Editable In-App
- **51 dropdown lists / 355 default options** seeded per user — 34 lists (296 options) for the trade form and 17 lists (59 options) for Analysis.
- **+ Add** inline on every dropdown; **Settings → Lists** for full CRUD, reorder, and colour, organised by category (Context, ICT Setup, Risk, Psychology, Analysis).
- **Soft-delete** — archiving an option hides it from entry forms but keeps historical trades/analyses intact and filterable.

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
| Testing | Vitest (unit tests for week keying, factor resolution, combos) |

---

## Data Model

```
tj_accounts          – broker accounts (currency, balance, IANA timezone)
tj_instruments       – tradeable symbols with point_value per asset class (9-symbol watchlist)
tj_option_lists      – 51 dropdown list definitions (Context, ICT Setup, Risk, Psychology, Analysis)
tj_option_items      – 355 default options (soft-deleteable)

tj_positions         – parent trade record (49 fields: context, ICT setup, risk plan, psychology)
tj_executions        – child fills (entry or exit, price, qty, fee, swap, timestamp UTC)
tj_position_stats    – SQL view: avg_entry, avg_exit, entry_qty, gross_pl, net_pl, realized_r

tj_bias_analyses     – weekly bias calls (instrument, direction, period, status, pair-level COT, week_start)
tj_market_context    – one global macro/vol snapshot per user per week (8 factors)
tj_cot_legs          – one COT card per user per week per underlying (currency/instrument leg factors)

tj_trade_images      – screenshot storage references
tj_import_batches    – import session metadata
tj_import_rows       – per-row import audit (raw + parsed + match status)
tj_column_mappings   – saved broker column-mapping presets
```

- All timestamps are stored as `timestamptz` (UTC). Display and import parsing convert to the per-account IANA timezone via `date-fns-tz`.
- Dropdown values are stored as plain text, so archiving an option never corrupts historical data.
- Analysis factors are **normalized by scope**: weekly globals in `tj_market_context`, per-leg COT in `tj_cot_legs`, pair-level COT on `tj_bias_analyses`. A client-safe resolver (`src/lib/journal/resolve.ts`) flattens all three scopes into the effective factor set consumed by the combo analytics.

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

The schema is managed as ordered Supabase migrations. Apply them via the Supabase CLI (`supabase db push`) or the SQL editor. The current migration set:

| Group | Migrations | Description |
|---|---|---|
| Core | `tj_core_config`, `tj_positions_executions`, `tj_import_and_storage`, `tj_harden_updated_at_fn`, `tj_positions_chart_url` | Tables, RLS policies, `tj_position_stats` view, Storage bucket, `updated_at` triggers |
| Seeding | `tj_seed_function`, `tj_auth_seed_trigger`, `tj_seed_harden_grants` | Per-user seed function, `AFTER INSERT ON auth.users` trigger, revoked grants |
| Analysis | `create_tj_bias_analyses`, `add_analysis_data_columns`, `seed_analysis_option_lists`, `add_analysis_seed_function`, `update_cot_score_options` | Bias tracking table, 17 analysis option lists, analysis seed |
| Watchlist | `watchlist_instruments_seed`, `replace_seed_defaults_instruments`, `enforce_watchlist_instruments` | 9-symbol instrument watchlist + enforcement |
| Scope split | `analysis_scope_split_m1_additive`, `analysis_scope_split_m2_drop_legacy` | `tj_market_context` + `tj_cot_legs`, `week_start`, then drop of relocated legacy columns |

New signups are seeded automatically by the auth trigger; `tj_seed_my_defaults` is also called on login as an idempotent fallback (`src/lib/journal/ensure-defaults.ts`).

After applying migrations, create your user in **Supabase Dashboard → Authentication → Users** (or via the sign-up form). For personal use, disable email confirmation under **Authentication → Providers → Email**.

---

## Testing

```bash
npm run test         # run the Vitest suite once
npm run test:watch   # watch mode
```

Unit tests cover the pure logic that underpins Analysis: UTC week keying (`week.ts`), factor resolution across scopes including the single-vs-pair rule (`resolve.ts`), and combo win-rate aggregation (`combos.ts`).

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

- **Row Level Security** is enabled on every `tj_*` table (`user_id = auth.uid()`), including the analysis tables (`tj_bias_analyses`, `tj_market_context`, `tj_cot_legs`). Even if another user registered, they could not read or write any other user's data.
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
│   │   ├── analysis/          # Market analysis (bias tracking + actions)
│   │   ├── trades/            # New / edit trade
│   │   ├── import/            # CSV/Excel import wizard
│   │   └── settings/          # Lists, instruments, accounts
│   ├── login/                 # Auth page
│   └── globals.css            # Tailwind v4 theme (dark by default)
├── components/
│   ├── journal/               # Feature components (form, grid, dashboard, heatmap, bias-analysis, …)
│   └── ui/                    # shadcn/ui primitives
├── lib/
│   ├── supabase/              # Client, server, proxy helpers + generated TS types
│   └── journal/               # Business logic
│       ├── analytics.ts       # Dashboard stats, equity curve, breakdowns
│       ├── trades.ts          # Trade/position queries
│       ├── bias.ts            # Analysis reads (analyses, contexts, legs) + stats
│       ├── resolve.ts         # Flattens analysis factors across scopes
│       ├── combos.ts          # Combination win-rate analytics
│       ├── analysis-config.ts # Factor scopes, symbol→legs mapping
│       ├── week.ts            # UTC ISO-week keying
│       ├── form-config.ts     # Declarative 49-field trade form
│       ├── options.ts / accounts.ts / instruments.ts / time.ts / format.ts / nav.ts
│       └── ensure-defaults.ts # Idempotent per-user seeding fallback
└── proxy.ts                   # Next.js 16 session proxy (replaces middleware.ts)
```

---

## License

Private — personal use only.
