# Faza 8B — automatski MAE/MFE preko cTrader Open API

> Detaljan plan implementacije. Status i kratak rezime žive u
> [ROADMAP.md](ROADMAP.md#faza-8--automatski-maemfe--polovina-a-isporučena-b-blokirana);
> ovaj fajl je referenca kad se posao nastavi.

## Kontekst

ROADMAP.md je Fazu 8B (automatsko računanje MAE/MFE — koliko je trejd bio blizu
stop-a/target-a) planirao oko OANDA v20 REST API-ja kao izvora sveća. Taj plan
je mrtav: OANDA je 2017. ukinula v20 pristup za EU klijente, a vlasnikov OANDA
nalog je EU-regulisan (potvrđeno — nema API opcije nigde u nalogu, samo
Dashboard/Manage Funds/Profile settings).

Pošto vlasnik trguje FTMO preko **cTrader** platforme, prelazimo na **cTrader
Open API** — besplatan, zvaničan, OAuth2, i vraća doslovno isti feed na kom se
trguje (tačnije od bilo koje treće strane). cTrader Open API aplikacija je već
registrovana (openapi.ctrader.com, ime "Trading Journal Price History Reader",
status "Submitted", ~3 radna dana do odobrenja Spotware KYC-a), scope
"Account info" (read-only, ne trading). Redirect URI
(`https://trading-journal-lilac-sigma-67.vercel.app/api/ctrader/callback` —
napomena: primarni dizajn u Delu 1 ovo ipak ne koristi kao REST rutu) i
Client ID/Secret su već sačuvani u `.env.local` / dokumentovani (bez vrednosti)
u `.env.example`.

Deterministički deo (Faza 8A — `excursion-scan.ts`, čist skener sveća) je već
isporučen i 100%-testiran. Ovaj plan pokriva ostatak: OAuth povezivanje naloga,
keš sveća, cTrader adapter, i UI okidače — sledeći isti obrazac kao 8A
("prvo determinističko, mreža čeka").

**Ispravka pretpostavke iz ROADMAP-a:** ROADMAP.md je pominjao H5 auto-recap
kao "prvi izuzetak od pravila bez REST ruta" — ali taj kod ne postoji
(`src/app/api/` ne postoji nigde u repou danas). Primarni dizajn ispod izbegava
REST rutu potpuno, pa ovaj izuzetak i dalje ne mora nikad da nastane.

## Deo 1 — OAuth povezivanje naloga (bez kršenja "bez REST ruta")

**Primarni pristup — Server Component stranica, ne `route.ts`:** Next.js App
Router dozvoljava da async Server Component čita `searchParams`, radi fetch i
upis u bazu tokom render-a, i pozove `redirect()` na kraju. To znači da OAuth
callback može biti obična stranica:

`src/app/(app)/settings/ctrader/callback/page.tsx` — čita `code`/`state` iz
`searchParams`, validira `state` protiv cookie-ja postavljenog pre redirect-a,
radi token exchange (`POST https://openapi.ctrader.com/apps/token` — običan
`fetch`, nema protobuf/socket ovde), upisuje token u novu tabelu, i redirektuje
na `/settings/ctrader`. Ovo **potpuno izbegava** REST route izuzetak — §4
pravilo ostaje netaknuto.

Fallback ako se ispostavi da Next 16.2.9 (proveriti `node_modules/next/dist/docs/`
pre pisanja koda, po `AGENTS.md`) ne dozvoljava side-effect + `redirect()` u
Server Component-u na način koji treba: `src/app/api/ctrader/callback/route.ts`
kao prvi pravi API route, uz izuzetak u `src/proxy.ts` matcher-u. Provereno:
`src/lib/supabase/middleware.ts:39-43` (`isPublic`) verovatno ni ne treba da se
menja — cTrader redirect je same-site top-level GET, Supabase session cookie
(SameSite=Lax) putuje s njim, `getUser()` treba da uspe bez ikakvog izuzetka.

**Čuvanje tokena — nova tabela**, ne na `tj_accounts` (to je
trading-account-settings red, 1:many po korisniku; OAuth grant je 1:1 po
Spotware identitetu i može imati više `ctidTraderAccountId`-jeva):

```sql
create table public.tj_ctrader_connections (
  user_id uuid primary key references auth.users,
  access_token text not null,
  refresh_token text not null,
  expires_at timestamptz not null,
  ctid_trader_account_id bigint,              -- null dok korisnik ne izabere nalog
  account_type text,                           -- 'demo' | 'live'
  linked_tj_account_id uuid references tj_accounts(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

RLS: `user_id = auth.uid()`, isti obrazac kao svaka druga tabela
(README.md — "Row-level security je uključen na svih 25 tabela").

**Odabir cTrader naloga:** posle token exchange-a, enumerisanje naloga
(`ProtoOAGetAccountListByAccessTokenReq`) ide preko TCP/protobuf protokola
(Deo 3), ne REST-a — zato se ne radi inline u callback stranici. Umesto toga,
`/settings/ctrader` dobija dugme "Fetch my cTrader accounts" (server akcija)
koje vraća listu naloga, korisnik bira, upisuje se
`ctid_trader_account_id` + `linked_tj_account_id`.

**Refresh tokena:** lenjo, ne cron (repo nema cron infrastrukturu). Server
akcija za sveće (Deo 5) proveri `expires_at` pre otvaranja TCP konekcije; ako
je istekao, prvo refresh POST, upiše novi token, pa nastavi.

**Iniciranje flow-a:** mala server akcija koja gradi
`https://openapi.ctrader.com/apps/auth?client_id=...&redirect_uri=...&scope=accounts&state=...`,
postavlja state cookie, vraća URL. Ako `redirect()` iz server akcije ne radi
čisto ka eksternom originu (proveriti u Next docs-ima), klijent radi
`window.location.assign(url)`.

## Deo 2 — Migracija

Novi fajl `supabase/migrations/<timestamp>_ctrader_excursion_source.sql`,
prateći obrazac iz `supabase/migrations/20260817120000_delete_account_and_reset.sql`
i `20260815150000_instrument_catalog.sql` (prozni header sa "zašto", explicit
`REVOKE`/`GRANT`):

```sql
create table public.tj_candles (
  symbol text not null,
  interval text not null,      -- 'm1'|'m5'|'m15'|'m30'|'h1'
  ts timestamptz not null,
  o numeric not null, h numeric not null, l numeric not null, c numeric not null,
  created_at timestamptz not null default now(),
  unique (symbol, interval, ts)
);

alter table public.tj_positions
  add column excursion_source text,           -- null | 'manual' | 'auto'
  add column excursion_fetched_at timestamptz;

create table public.tj_ctrader_connections ( ... kao u Delu 1 ... );
```

**`tj_candles` nema `user_id`** — tržišni podatak, deljen keš, ne per-user
podatak (jedina takva tabela u šemi — vredi eksplicitno napomenuti u header
komentaru migracije zašto je izuzetak). Pristup pisanju: `SECURITY DEFINER`
funkcija (`tj_upsert_candles`), `REVOKE`-ovana od `anon`/`authenticated`
direktno, pozvana samo iz server akcije — izbegava potrebu za service-role
ključem (kog repo danas uopšte nema, `server.ts` koristi samo anon key).

**Zaključavanje `excursion_source`** (pravilo iz ROADMAP-a — ručno mora da
pobedi automatski): modelovati kao `SECURITY DEFINER` funkcija
`tj_write_auto_excursion(position_id, mae, mfe, fetched_at)` koja piše samo
`where excursion_source is null or excursion_source = 'auto'`. Ručni unos
(postojeći put: `trade-form.tsx:463-479`, polja `max_drawdown_price` /
`max_profit_price` → `excursionFromTrade` iz `excursion.ts`) treba da postavi
`excursion_source = 'manual'` bezuslovno — pronaći tačno mesto gde se taj
manual save dešava i dodati to polje u isti update.

## Deo 3 — cTrader adapter (jedini deo koji zna za mrežu)

**Ključna arhitektonska činjenica:** cTrader Open API sveće
(`ProtoOAGetTrendbarsReq`) idu preko **Protobuf-preko-TLS TCP-a**
(`demo.ctraderapi.com:5035` / `live...`), NE REST-a. Vercel-ov Node.js
serverless runtime (ne Edge) dozvoljava sirove TCP/TLS konekcije preko
`node:net`/`node:tls` — ograničenje je budžet vremena, ne mogućnost. Jedan
fetch (TLS connect → app auth → account auth → get trend bars → close) je
3-4 round-trip-a na jednoj TLS sesiji — nisko-jednocifreni sekundi, ali
default Vercel timeout (10-15s) je tesan.

Plan: server akcija u sopstvenom fajlu sa `export const maxDuration = 60;` —
**proveriti tačnu sintaksu za Next 16.2.9 u `node_modules/next/dist/docs/`**
pre pisanja, po `AGENTS.md`.

**Biblioteka — spike, ne pretpostavka.** Nema protobuf/socket zavisnosti u
`package.json` danas. Kandidat: `@reiryoku/ctrader-layer` (community TS
klijent) — ne može se proveriti bez mreže/odobrenog naloga. Koraci:
1. Kad app postane "Active": lokalni scratch skript (van Vercel-a) — connect,
   auth, jedan trend-bar zahtev, disconnect, protiv demo hosta. Proveriti da
   li paket radi request-response jednokratno (mnogi cTrader JS klijenti
   pretpostavljaju dugotrajan bot proces — pogrešan oblik za serverless poziv).
2. Fallback ako ne odgovara: `protobufjs` + Spotware-ovi `.proto` fajlovi
   vendorovani u `src/lib/ctrader/proto/`.

Izlaz adaptera je `Candle[]` u tačnom obliku koji `excursion-scan.ts` (linije
51-57) već očekuje (`{ t, o, h, l, c }`) — nema potrebe za bid/ask. Lokacija:
`src/lib/journal/ctrader-adapter.ts`, **namerno van** `MONEY_MODULES` liste u
`vitest.config.ts` (ostaje I/O, ne aritmetika).

## Deo 4 — Mapiranje simbola (odloženo, nije blokada za build)

`instrument-aliases.ts` već normalizuje varijante preko `cleanInstrumentKey` +
`INSTRUMENT_ALIAS_TO_CANONICAL`, i već sadrži `US500`/`SPX500USD` → `SP500` i
`USTEC`/`NDX` → `NAS100` mapiranja — verovatno već anticipira cTrader-stil
imena. Nema potrebe za novim mehanizmom. Ono što nije provereno: FTMO vodi
sopstvenu cTrader server instancu, pa je tačna lista simbola FTMO-specifična.
Verifikacija (posle "Active" statusa): `ProtoOASymbolsListReq` (pokriveno
"Account info" scope-om, ne treba trading), diff protiv
`default-instruments.ts` (linija 193), dodati fale aliase.

## Deo 5 — Server akcije + UI

- **`src/app/(app)/trades/ctrader-actions.ts`** (`maxDuration = 60`):
  `fetchExcursionForPosition(positionId)` — učita poziciju + `tj_position_stats`
  (opened_at, closed_at, avg_entry, avg_exit, direction —
  `src/lib/supabase/types.ts:1243-1275`), `suggestInterval(holdMs)`, proveri
  `tj_candles` keš, fetch-uje samo gap preko adaptera, upiše u keš, pozove
  `scanExcursion(...)`, upiše preko `tj_write_auto_excursion`. Prati obrazac iz
  `src/app/(app)/trades/actions.ts` (`"use server"`, svež `createClient()`
  unutar funkcije, `{ok:true,...}|{ok:false,error}`, `revalidatePath`).
- **Dugme na trejdu:** `src/app/(app)/trades/[id]/edit/page.tsx` (jedina
  stranica pod `/trades/[id]` — nema posebne detail stranice), pored
  postojećeg MAE/MFE ručnog unosa; disable/relabel kad je `excursion_source`
  već `'manual'`.
- **Backfill na `/journal`:** `backfillExcursions(limit)` — iterira zatvorene
  pozicije bez `excursion_source`. Zbog timeout budžeta iz Dela 3, **ne može
  biti "backfil sve odjednom"** za veći journal — dugme "Backfill sledećih N"
  koje se ponovo poziva, ne jednokratno dugme. Ovo je odstupanje od
  ROADMAP-ove jednoredne napomene, forsirano serverless ograničenjem.

## Deo 6 — Test strategija

- `excursion-scan.ts` — bez izmena, ostaje na 100% pragu.
- `ctrader-adapter.ts` — **van** `MONEY_MODULES`, testira se mock-ovanjem
  protobuf klijenta na granici modula (mapiranje response → `Candle[]`,
  error/timeout putanje vraćaju `{ok:false}`, ne bacaju).
- `tj_write_auto_excursion` — SQL, bez vitest pokrića; ručna verifikacija u
  Supabase SQL editoru posle primene migracije na dev projekat.
- `fetchExcursionForPosition` — `src/app/**` je već isključen iz coverage-a
  (`vitest.config.ts:79-93`); mock-ovati adapter + Supabase klijent, testirati
  orkestraciju (keš-hit preskače fetch, lock poštuje manual).
- Sve što traži pravu cTrader konekciju (spike, verifikacija simbola,
  end-to-end) ostaje blokirano do "Active" statusa — nema zaobilaska.

## Sekvenca

**Gradi se i testira sada, bez mreže:**
1. Migracija (Deo 2) — piše se, primenjuje na dev Supabase odmah
2. OAuth callback stranica + iniciranje flow-a (Deo 1) — token exchange je
   stabilan dokumentovan HTTPS endpoint, radi i dok je app "Submitted"
3. Skelet server akcije + UI (Deo 5), sa **stub adapterom** (lažne sveće) dok
   pravi adapter čeka mrežu — kompletna orkestracija (keš, `scanExcursion`,
   lock) gotova i testirana pre nego što KYC prođe

**Blokirano do "Active" statusa:**
1. Spike biblioteke (Deo 3, korak 1)
2. Verifikacija simbola (Deo 4)
3. Podešavanje `maxDuration`/batch veličine na osnovu realne latencije
4. End-to-end provera celog lanca

## Verifikacija

- Migracija: primeniti na dev Supabase projekat, ručno proveriti RLS (drugi
  korisnik ne vidi tuđ `tj_ctrader_connections` red), proveriti da
  `tj_write_auto_excursion` odbija upis kad je `excursion_source = 'manual'`
- `npm run test` — `ctrader-adapter.test.ts` i orkestracija u
  `ctrader-actions` prolaze sa mock-ovanim mrežnim slojem; `excursion-scan.ts`
  ostaje na 100%
- OAuth: kliknuti "Connect cTrader" u `/settings/ctrader`, proći kroz cTrader
  consent ekran, potvrditi da se `tj_ctrader_connections` red upiše i da se
  redirect vrati na app
- Kad app postane "Active": pokrenuti lokalni spike skript, pa jedan pravi
  `fetchExcursionForPosition` poziv na test trejdu, uporediti rezultat sa
  ručno pročitanim MAE/MFE sa TradingView grafikona
