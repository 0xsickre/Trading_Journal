# Faza 8B — automatski MAE/MFE: backtest preko Dukascopy, trading preko MT5

**Status na 19.09.2026:** backtest nalozi su rešeni — **Dukascopy 1-minutne sveće**, automatski
(`dukascopy.ts`, `dukascopy-fetch.ts`, `excursion-feed.ts`, `excursion-fill.ts`; README § „Half built,
half waiting"). Trading nalozi čekaju **MT5**: paket `MetaTrader5` iz FTMO terminala na ovom računaru
daje brokerove cene na tick; upisivaće `excursion_source = 'mt5'` kroz isti put.

**Status na 18.09.2026:** ovaj fajl je do tada sadržao pun plan za **cTrader Open API** (OAuth2,
`tj_ctrader_connections`, Protobuf-preko-TLS adapter, mapiranje simbola i sekvenca posla oko Spotware
KYC-a). Plan je povučen i ne treba ga oživljavati u tom obliku.

**Zašto.** Imao je smisla dok je postojao cTrader bot most: isti broker, isti feed na kom se trguje, i
polovina infrastrukture (mapiranje naloga kroz `broker_account_id`, mapiranje simbola kroz
`tj_broker_symbol_map`) već napravljena. Trgovanje prelazi na **MT4/MT5**, most je uklonjen
(`20260918120000_remove_bot_bridge.sql`, ROADMAP § Faza 11), pa su obe polovine nestale, a ni feed
više nije onaj na kom se trguje.

**Šta je ostalo upotrebljivo i stoji spremno:**

- `src/lib/journal/excursion-scan.ts` — bira interval (1m–1h) prema dužini držanja i broji samo sveću
  koja cela staje u prozor trejda. Testiran, na listi sa 100% pokrivenosti u `vitest.config.ts`.
  **Ne zna i ne mora da zna odakle sveće dolaze.**
- `max_drawdown_price` / `max_profit_price` na `tj_positions`, sa ručnim unosom u formi trejda.
- Nauk iz Faze 11, ako izbor padne na program koji sam javlja: heartbeat, jer tiho ćutanje izgleda kao
  zdravlje; idempotentnost po ključu događaja; i karantin umesto pogađanja naloga.

**Otvoreno pitanje — izvor sveća (ili ekstrema) za MT4/MT5.** Kandidati, nijedan izabran:

1. **MT5 export** minuta oko svakog trejda iz terminala. Bez mreže i bez tajni, ali je ručni korak po
   trejdu.
2. **Expert Advisor** koji dok je pozicija otvorena beleži ekstreme i šalje ih dnevniku. Najtačnije,
   jer meri na tikovima, ali je to ponovo most, sa svim što je Faza 11 naučila.
3. **Treći candle API** za nekoliko instrumenata koji se stvarno trguju (NAS100, XAUUSD, bakar).
   Najlakše za izvesti, ali cene nisu brokerove, pa MAE/MFE postaje približan — i to mora da piše
   pored broja.

Za trading naloge, dok se MT5 ne poveže, MAE/MFE ostaje ručni unos. Tako piše i u README § „Half built, half waiting" i u
ROADMAP § Faza 8B, da se prazno polje ne pročita kao nešto što je neko zaboravio da popuni.
