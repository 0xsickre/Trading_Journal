# ICT Trading Journal

A professional ICT (Inner Circle Trader) trade journal web app: log executions, review performance, import broker exports, and analyse your own trading statistics. Single user by design, multi-tenant safe by construction — every table is protected by Postgres Row Level Security.

**Makro bias / COT / nedeljni plan** žive u Trading data vault-u i trading-dashboard-u (F0–F4). TA plan za F5 ide u Notion (kasnije) — ovaj repo je **samo journal + PnL + daily process report**. Per-trade polja `macro_align` i `cot_filter` linkuju svaki trejd nazad na taj vault sistem.

---

## Feature Overview

| Area | What it does |
|---|---|
| Dashboard | 16 performance stat cards, equity curve, R-distribution, calendar heatmap, tag breakdowns |
| Daily Report | **Dnevni izveštaj** (Serbian UI): process-only daily journal, focus goal, A–F day grade (not P&L), no-trade day, morning / mid-day / evening debrief |
| Journal | Sortable/filterable trade grid with CSV + Excel export |
| New Trade | Streamlined ICT trade form (~25 fields) with partial-exit fills and a position-size calculator; edit existing trades at `/trades/[id]/edit` |
| Import | CSV/Excel broker import with column mapping and per-row reconciliation |
| Settings | In-app CRUD for dropdown lists, instruments, and accounts |
| FTMO mode | Per-account prop-firm challenge tracking (daily loss, max drawdown, profit target, min days) |
| Mentor pack | One-click Markdown export of pre-computed stats to upload into an LLM for feedback |

---

## Localization

The app is **mixed English / Serbian**:

| Area | Language |
|------|----------|
| Daily Report (`/daily`) | **Serbian** — nav label **Dnevni izveštaj**, all form labels, toasts, Douglas mantras, market-type labels |
| FTMO banner & Settings → Accounts FTMO block | **Serbian** (e.g. Zamrznut, Reset izazov) |
| Mentor pack export | **Serbian** AI instructions in the Markdown file |
| Trade form | **Mixed** — mostly English labels; Serbian placeholders (miss notes, MAE/MFE), lifecycle actions (*Vrati u planned*), FTMO freeze toasts |
| Dashboard, Journal, Import, Settings (rest) | **English** (dashboard export preview shows **Izvoz:**) |

---

## Features

### Daily Report — Dnevni izveštaj (process journal)

Nav: **Dnevni izveštaj** (`/daily`). Entire module UI is in **Serbian**; dates render with `date-fns` locale `sr` (e.g. `sre, 22. jul 2026.`).

- **Calendar day = primary account timezone** — one row per `(user_id, report_date)` where `report_date` is derived from `getPrimaryAccount().timezone` (not per-account daily reports in v1).
- **Persistent focus goal** — one active goal for weeks; day grade (A–F) measures progress on that goal only, never P&amp;L (Trillium-informed). Set, edit, or **graduate** a goal from the focus-goal card; completing a report requires an active goal plus day grade and rule-broken answer.
- **Date navigation** — prev/next day controls; future dates are clamped to today in the primary account timezone. **Danas** shortcut when viewing a past day.
- **Ocena dana** — grades A–F; badge shows **Kompletan** vs **Nacrt** based on completion rules.
- **No-trade day** (`no_trade_day`) — checkbox *Dan bez trejdova (no-trade day)* for days with zero entries. When checked: hides **Tokom dana** and **Kontrola impulsa** cards plus Douglas mantra / risk-acceptance block in the morning section; clears micromanage, impulse flags, and `risk_accepted`. Evening debrief still shown. Does **not** bypass day-grade or rule-broken requirements.
- **Jutro · pre trejda** — mental temperature (1–10), sleep quality (1–5), macro note, Tharp market type (Serbian labels: Bik/Medved/Bočno × Mirno/Volatilno), Douglas mantra acknowledgements, risk acceptance, mental rehearsal. **Low-mental alert** when temperature &lt; 5.
- **Tokom dana** — mid-day check for intraweek swing (London, NY, or between sessions — not only at evening debrief). **Untouched-first micromanage flow**: checkbox *Nisam dirao otvorene pozicije danas* sets `micromanage = untouched` (no stop moves, partial exits, averaging, or unplanned closes). If unchecked, follow-up buttons **Pratio sam** / **Prekršio sam** (`watched` / `violated`). Hidden on no-trade days.
- **Kontrola impulsa** — Douglas's four fears (FOMO, fear of loss, fear of being wrong, greed) plus optional impulse note. Micromanage tracking lives in **Tokom dana**, not here. Hidden on no-trade days.
- **Veče · debrief** — rule broken?, learned today, tomorrow changes with solutions, easiest layup setup, day overview, celebrate a process win.
- **Petak pravilo** — weekend exposure checkbox on Fridays (`friday_flat`).
- **Manual save** — isolated from trades/accounts in v1; server action `saveDailyReport` upserts on `(user_id, report_date)`.

### Trade Logging
- **Streamlined trade form** (~25 fields) across Plan & Setup and Execution & Review — `ict_entry_model`, `setup_grade`, unified `technical_tags`, and one `trade_journal_notes` field instead of overlapping tag/dropdown/text columns.
- **Partial exit / scale-out support** — one parent position with multiple execution fills; accurate weighted R-multiple across every exit.
- **Gross vs Net P/L** separation — raw price movement vs. P/L after fees and swap/funding.
- **TradingView snapshot embeds** — three chart slots per trade (**HTF Pre**, **LTF Pre**, **LTF Post**) in `tj_trade_images` as `tradingview.com/x/…` snapshot URLs (not uploaded files). Zero file-hosting cost; PNG rendered from the snapshot ID. Managed via browser Supabase client (RLS). Legacy `chart_url` on `tj_positions` was removed — gallery is the single source of truth. (No Supabase Storage.)
- **Position-size calculator** — auto **Position Size** from risk % × account balance ÷ (stop distance × point value); updates live in Risk Plan.
- **Planned R:R** — auto-calculated from entry / stop / target (direction-aware); stored as reward multiple (e.g. `2.45`), not a dropdown.
- **Direction** — auto-set from entry vs stop (`stop < entry` → Long, `stop > entry` → Short) as soon as both prices are entered; updates live when prices change.
- **Progressive Risk Plan** — fields appear step-by-step: entry → stop → target + risk % → position size → planned R:R (reduces input errors).
- **Trade lifecycle** — `planned` = setup with entry/stop/target but **no broker fill**; `open` once you log an entry fill; `partial` when exit qty &lt; entry qty (scale-out in progress); `closed` when fully exited; `missed` = plan never opened (`miss_reason` + `missed_at` for review). Planned Entry ≠ open position. Journal grid has a dedicated **Missed** filter.
- **Import review** — imported rows without fills get `needs_review: true`; journal grid offers **Activate** (`activateTrade`) to confirm and open them.
- **Form prefs** — last-used `accountId` and `riskPct` persisted in `localStorage` (`tj:trade_form_prefs`).
- **Macro linkage** — per-trade `macro_align` (Uz bias / Protiv bias / Van scope), `cot_filter` (Ulaz dozvoljen / Odložen / Ne chase), and `htf_bias` tie each execution back to the Trading data vault context (not a separate macro module).
- **MAE / MFE** — `max_drawdown_price` and `max_profit_price` at review; live MAE/MFE in R and MFE capture % in the trade form metrics bar.
- **Entry slippage** — computed from **Planned Entry Price** (`entry_price`) vs **avg entry** from fills. Shown in R vs planned stop distance (adverse fill = negative R display). Requires planned entry + at least one entry fill; stop needed for R. Dashboard: avg/total slip R + weekly chart. Mentor export includes per-trade and summary slippage.
- **Target attainment %** — `realized_r / planned target R` (from `planned_rr` or entry/stop/target). Measures how much of your planned reward you captured (e.g. planned 3R, took 1.2R → 40%). Dashboard: avg + winner-only + weekly chart. Distinct from **MFE Capture %** (realized / MFE excursion, shown in the trade form). Journal grid + trade form + mentor export.

### FTMO / Prop-Firm Challenge Mode
- **Per-account toggle** — enable challenge tracking on any account in **Settings → Accounts**; off by default, additive so existing accounts are unaffected. FTMO section labels are **Serbian**.
- **Configurable rules** — max daily loss %, max total loss / static drawdown %, profit target %, and minimum trading days, each individually toggleable (defaults 5% / 10% / 10% / 4 days).
- **Live evaluation** — rules are computed in-app from **realized (closed) net P/L** per account timezone; the dashboard shows a per-account **FTMO banner** with status (`active` / `passed` / `failed` — UI: Aktivan / Položen / Zamrznut), profit %, drawdown %, and the earliest breach per broken rule.
- **Account freeze** — when status is `failed`, **new trades are blocked** on that account (`createTrade` returns a Serbian error) until you **Reset izazov** in Settings.
- **Challenge reset** — `resetFtmoChallenge` sets `ftmo_reset_at` so trades before the reset are ignored; you can re-run a challenge on the same account.
- **Approximation note** — a real prop firm measures intraday *equity* including open floating P/L; a journal only knows *realized* results, so this trains discipline on a demo account rather than replacing the broker's risk engine.

### Mentor Pack Export
- **"Export for Claude"** button on the dashboard downloads a self-contained Markdown file for the selected period (Day / Week / Month / Quarter / Year / **Custom** / All).
- Stats (win rate, profit factor, expectancy, slippage, target attainment, and tag breakdowns) are **pre-computed** in the file so an LLM interprets the numbers instead of recalculating (or hallucinating) them — no API integration required.
- Export includes **Serbian AI mentor instructions** (*Uputstvo za tebe (AI mentor)*) telling Claude to respond in Serbian and not recalculate stats. Breakdowns include **HTF bias** (dashboard breakdown table does not offer `htf_bias` as a group-by option).
- Up to **300 closed trades** expanded in full detail per export; open / needs-review and missed setups listed separately.

### Dropdowns — Fully Editable In-App
- **17 dropdown/tag lists** seeded per user (**16** on the trade form — `session_killzone` is seeded for Settings/history but omitted from the trade entry form). Merged `technical_tag` list replaces separate confluence/setup/micro-ICT lists; organised by category: **Context** (direction, macro align, COT filter, HTF bias, entry TF), **ICT Setup** (technical tags, entry model, setup grade), **Risk** (risk %, result, exit reason, miss reason), **Psychology** (emotion, discipline, rules followed, mistake).
- **+ Add** inline on every dropdown; **Settings → Lists** for full CRUD, reorder, and colour.
- **Soft-delete** — archiving an option hides it from entry forms but keeps historical trades intact and filterable.

### Journal Grid
- TanStack Table with sort, search, and per-column filters (instrument, direction, grade, model, result, status) plus a dedicated **Missed** toggle.
- Columns: trade #, date (account timezone), instrument, direction, grade, size, entry, slip R, exit, R, target attainment %, gross P/L, net P/L, status, TradingView snapshot link (primary image).
- One-click CSV and Excel export of the current filtered view.

### Analytics Dashboard
- **16 stat cards** — Trades, Win rate, Net P/L, Gross P/L, Total R, Avg R, Profit factor, Expectancy, Best, Worst, Win/Loss streak, Max drawdown, Avg entry slip, Total slip R, Target attainment (all + winners). Portfolio stats use **closed** positions only (partials excluded).
- **FTMO banners** — one per account with challenge mode enabled (see FTMO section).
- **Equity curve** — Gross ↔ Net toggle, $ or R metric, cumulative from account starting balance.
- **R-distribution histogram** — colour-coded bars from `<−3R` to `>5R`.
- **Calendar heatmap** — 26-week daily P/L in account timezone.
- **Weekly charts** — entry slippage (R) and target attainment (%) by week.
- **Breakdown table** — win rate, total R, avg R, net P/L grouped by macro align, COT filter, setup grade, technical tags, entry model, direction, instrument, psychology tags, or mistake. Mentor export also includes **HTF bias** breakdowns (not available as a dashboard group-by).
- Account and date-range filters throughout.

### Import & Reconciliation
- Upload a CSV or Excel broker export.
- Column-mapping UI with **keyword auto-detect** (manual override per column). Table `tj_column_mappings` exists in the schema for future saveable broker presets — **not wired in the UI yet**.
- Smart per-row reconciliation: **Create / Merge / Skip**.
  - Merge updates only objective execution fields (price, qty, fee, swap) — psychology, ICT model, and notes are never overwritten.
  - Full diff highlighting of changed values.
- Instrument alias normalization (e.g. `US500.cash` → `SP500`, `GOLD` → `XAUUSD`, `Copper` → `HG`).
- Rows imported without fills are flagged `needs_review`; activate from the journal grid when ready.
- Raw import rows stored for an audit trail (`tj_import_batches` + `tj_import_rows`).

### Instruments & Accounts
- **B6 FTMO watchlist** — synced with Trading data vault `instrument_registry`: **8 active trade** symbols (`EURUSD`, `GBPUSD`, `USDJPY`, `USDCAD`, `AUDUSD`, `SP500`, `NAS100`, `XAUUSD`) plus **2 radar** (`HG`, `RTY`) — seeded on signup (`tj_seed_instruments_defaults`). CSV import normalizes broker aliases (e.g. `US500.cash` → `SP500`, `US100.cash` → `NAS100`, `GOLD` → `XAUUSD`).
- Per-instrument `point_value` for P/L math across asset classes (editable in Settings). P/L is in the instrument's **quote currency** — not FX-converted to account currency (see comment in `default-instruments.ts`).
- Multiple accounts with individual currency, starting balance, **IANA timezone**, and optional FTMO challenge config — all timestamps display in the account's local time regardless of the user's machine. **Primary account** timezone drives Daily Report calendar days.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router, Server Actions, TypeScript) |
| UI | React 19, dark theme by default (Geist fonts) |
| Styling | Tailwind CSS v4 + shadcn/ui (Radix + Base UI primitives) |
| Database | Supabase Postgres with Row Level Security |
| Auth | Supabase Auth via `@supabase/ssr` |
| Chart images | TradingView `/x/` snapshot embeds (no file storage) |
| Table | TanStack Table v8 |
| Charts | Recharts v3 |
| Forms | react-hook-form + Zod |
| Import/Export | PapaParse (CSV) + SheetJS/xlsx (Excel) |
| Time | date-fns / date-fns-tz |
| Testing | Vitest |

---

## Data Model

```
tj_accounts          – broker accounts (currency, balance, IANA timezone, FTMO challenge config)
tj_instruments       – tradeable symbols with point_value per asset class (B6 10-symbol watchlist)
tj_option_lists      – 17 dropdown/tag list definitions (Context, ICT Setup, Risk, Psychology;
                       session_killzone seeded but not on trade form)
tj_option_items      – default options (soft-deleteable)

tj_positions         – parent trade record: technical_tags[], psychology_tags[], trade_journal_notes,
                       ICT setup (ict_entry_model, setup_grade, htf_bias, entry_tf), risk plan
                       (entry_price, stop_price, target_price, planned_rr), macro linkage
                       (macro_align, cot_filter), MAE/MFE (max_drawdown_price,
                       max_profit_price), lifecycle (status, miss_reason, missed_at)
tj_executions        – child fills (entry or exit, price, qty, fee, swap, timestamp UTC)
tj_position_stats    – SQL view (security_invoker): avg_entry, avg_exit, entry_qty, gross_pl,
                       net_pl, realized_r, realized_r_net

tj_trade_images      – TradingView /x/ snapshot URLs per trade (htf_pre, ltf_pre, ltf_post)
tj_focus_goals       – one active process goal per user (goal_text, started_at, ended_at, is_active)
tj_daily_reports     – one row per calendar day: day grade, morning/evening debrief,
                       mid-day micromanage (untouched / watched / violated), Douglas impulse flags,
                       friday_flat, no_trade_day
tj_import_batches    – import session metadata
tj_import_rows       – per-row import audit (raw + parsed + match status)
tj_column_mappings   – broker column-mapping presets (schema only — UI not implemented yet)
```

- All timestamps are stored as `timestamptz` (UTC). Display and import parsing convert to the per-account IANA timezone via `date-fns-tz`.
- Dropdown values are stored as plain text, so archiving an option never corrupts historical data.
- `tj_position_stats` runs with `security_invoker = on` so a direct REST query on the view respects each user's RLS instead of the view owner's.

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
npm run dev      # http://localhost:3000
npm run build    # production build
npm run lint     # ESLint (eslint-config-next)
```

### Database Setup

Apply migrations via the Supabase CLI (`supabase db push`) or the SQL editor. The repo includes `supabase/migrations/` — **incremental deltas only** (from `20260719120000` onward); a fresh Supabase project needs the full baseline schema plus all files in order. Latest: `20260722130000_daily_report_no_trade_day.sql` (`no_trade_day` on `tj_daily_reports`; prior file `20260722120000_daily_reports.sql` creates the table + focus goals).

| Migration | Summary |
|-----------|---------|
| `20260719120000` | Drop legacy analysis module tables |
| `20260719143000` | B6 10-symbol instrument universe |
| `20260719150000` | Remove session_killzone option list (later migrations re-seed it; still omitted from trade form) |
| `20260720120000` | `technical_tags` + `trade_journal_notes`; drop legacy tag columns |
| `20260720130000` | MAE/MFE price columns |
| `20260720140000` | Drop vix_regime, news_nearby |
| `20260720150000` | TradingView snapshot images; drop `chart_url` |
| `20260720160000` | RLS initplan fix, indexes, TV URL CHECK, RPC hardening |
| `20260720170000` | `tj_position_stats` view |
| `20260721120000` | `macro_align`, `cot_filter`; trim option lists |
| `20260721130000` | Trade lifecycle `missed` + miss_reason list |
| `20260721140000` | `security_invoker` on view |
| `20260721150000` | FTMO account columns |
| `20260722120000` | `tj_daily_reports` + `tj_focus_goals` |
| `20260722130000` | `no_trade_day` on daily reports |

If an old **`trade-images`** Storage bucket still exists from an earlier version, you may delete it manually in **Supabase Dashboard → Storage** — chart images are now TradingView `/x/` URL strings only, so no bucket is required.

New signups are seeded automatically by the auth trigger; `tj_seed_my_defaults` is also called on login as an idempotent fallback (`src/lib/journal/ensure-defaults.ts`).

After applying migrations, create your user in **Supabase Dashboard → Authentication → Users** (or via **Sign in / Create account** tabs on `/login`). For personal use, disable email confirmation under **Authentication → Providers → Email**.

---

## Testing

```bash
npm run test         # run the Vitest suite once
npm run test:watch   # watch mode
```

The suite covers pure business logic in **11 Vitest files** under `src/lib/journal/` — analytics, position/plan math, entry slippage, exit efficiency, FTMO evaluation, trade lifecycle, instrument aliases, TradingView snapshot parsing, daily-report date/completion helpers, focus-goal day counting, and default instruments.

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

## Architecture

- **No REST API routes** — all mutations go through **Next.js Server Actions** (`login/`, `daily/` — `saveDailyReport`, `saveFocusGoal`, `endFocusGoal` — `trades/`, `import/`, `settings/actions.ts`). Reads use Supabase server client in Server Components.
- **Session proxy** — `src/proxy.ts` (Next.js 16) refreshes Supabase auth and redirects unauthenticated users to `/login`.
- **TradingView images** — the `TradeImages` component writes directly to `tj_trade_images` via the browser Supabase client (RLS-protected), not Server Actions.
- **Defaults seeding** — auth trigger `tj_on_auth_user_created` (if configured in your Supabase project) plus idempotent `tj_seed_my_defaults` RPC on dashboard load (`ensure-defaults.ts`).
- **Responsive shell** — desktop sidebar + mobile horizontal nav (`AppSidebar` / `MobileTopbar` in `app-sidebar.tsx`).

---

## Security

- **Row Level Security** on every `tj_*` table (`user_id = (select auth.uid())` — initplan-safe), including `tj_focus_goals` and `tj_daily_reports`. Even if another user registered, they could not read or write any other user's data.
- **`tj_position_stats`** runs with `security_invoker = on`, so the view honours the querying user's RLS on the underlying tables instead of bypassing it.
- **No Supabase Storage** for chart images — only TradingView `/x/` URL strings in `tj_trade_images` (zero file hosting cost).
- The `service_role` key is never referenced in frontend code — only the `anon` publishable key is exposed.
- Internal seed functions (`tj_seed_defaults`, `tj_seed_instruments_defaults`, `rls_auto_enable`) are revoked from `anon`; `tj_seed_my_defaults` remains the authenticated login fallback (`ensure-defaults.ts`).
- `tj_trade_images.image_url` has a DB CHECK constraint (`tradingview.com/x/…` only).
- All authentication is handled by Supabase Auth (bcrypt, JWT, optional MFA available).

---

## Project Structure

```
src/
├── app/
│   ├── (app)/                 # Protected routes (auth-checked layout)
│   │   ├── page.tsx           # Dashboard
│   │   ├── journal/           # Journal grid
│   │   ├── daily/             # Daily Report + focus goal (+ actions.ts)
│   │   ├── trades/            # New / edit trade (+ actions.ts)
│   │   │   ├── new/page.tsx
│   │   │   └── [id]/edit/page.tsx
│   │   ├── import/            # CSV/Excel import wizard (+ actions.ts)
│   │   ├── settings/          # Lists, instruments, accounts (+ actions.ts)
│   │   └── loading.tsx        # Route-level loading skeleton
│   ├── login/                 # Auth page (sign-in / sign-up tabs) + actions
│   └── globals.css            # Tailwind v4 theme (dark by default)
├── components/
│   ├── app/                   # App shell (sidebar + mobile topbar)
│   ├── journal/               # Feature components (trade form, grid, dashboard,
│   │                          #   daily report, focus goal, heatmap, import wizard,
│   │                          #   FTMO banner, settings, …)
│   └── ui/                    # shadcn/ui primitives
├── lib/
│   ├── supabase/              # client / server / middleware / user helpers + generated TS types
│   └── journal/               # Business logic
│       ├── analytics.ts       # Dashboard stats, equity curve, breakdowns, weekly series
│       ├── position-stats.ts  # Shared P/L + R math (paritet sa SQL view)
│       ├── plan-calculations.ts  # Position size, planned R:R, direction
│       ├── entry-slippage.ts  # Planned-vs-fill entry slippage (pts + R)
│       ├── exit-efficiency.ts # Target attainment (realized R / planned reward R)
│       ├── ftmo.ts / ftmo-status.ts  # Prop-firm challenge evaluation
│       ├── mentor-export.ts   # Markdown "mentor pack" builder
│       ├── trade-lifecycle.ts # plan / open / closed / missed status logic
│       ├── tradingview-snapshot.ts  # /x/ snapshot URL parsing + validation
│       ├── instrument-aliases.ts / default-instruments.ts  # B6 watchlist + broker aliases
│       ├── daily-report.ts / daily-report-queries.ts  # Process journal types + DB queries
│       ├── focus-goal.ts / focus-goal-queries.ts  # Active focus goal + day counting
│       ├── trades.ts          # Trade/position queries
│       ├── form-config.ts     # Declarative trade form (~25 fields)
│       ├── trade-form-prefs.ts   # localStorage form defaults (account, risk %)
│       ├── types.ts           # Client-safe shared types
│       ├── options.ts / accounts.ts / instruments.ts / time.ts / format.ts / nav.ts
│       └── ensure-defaults.ts # Idempotent per-user seeding fallback
└── proxy.ts                   # Next.js 16 session proxy (replaces middleware.ts)
```

---

## Metrics glossary

| Metric | Formula | Notes |
|--------|---------|-------|
| **Gross P/L** | `(exitNotional − avgEntry × exitQty) × dir × point_value` | Price move before fees |
| **Net P/L** | `gross_pl − fees − swap` | After costs |
| **Realized R (gross)** | `gross_points / (|planned_entry − stop| × entry_qty)` | Denominator uses **planned** `entry_price` (fallback avg fill) |
| **Realized R (net)** | `net_pl / (planned_risk_$)` | `realized_r_net` column in `tj_position_stats` |
| **Target attainment %** | `realized_r / planned_target_R × 100` | How much of your planned reward you took |
| **MFE Capture %** | `realized_r / mfe_R × 100` | How much of max favorable excursion you kept (trade form) |
| **Entry slippage** | adverse pts / \|planned entry − stop\| in R | Separate from P/L — not double-counted |
| **Profit factor** | sum(wins) / sum(\|losses\|) | Closed trades only |
| **Expectancy** | winRate×avgWinR + lossRate×avgLossR | avg win/loss R only from trades with valid R |
| **FTMO drawdown %** | `(starting_balance − min_equity) / starting_balance × 100` | Worst realized equity dip from start, closed trades in account tz |

Portfolio dashboard stats (win rate, PF, expectancy) include **closed** positions only. Partial exits are excluded unless you opt in via `toRealized({ includePartial: true })`.

---

## License

Private — personal use only.
