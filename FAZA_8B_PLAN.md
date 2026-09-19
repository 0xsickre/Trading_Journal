# Faza 8B — automatski MAE/MFE: trading preko MT5, backtest ručno

**Status na 19.09.2026 (kraj dana):** trading nalozi dobijaju MAE/MFE iz FTMO MT5 terminala,
`scripts/mt5_excursion.py` (README § „MAE/MFE comes from MT5 on live accounts"). Backtest nalozi se
unose ručno. Dukascopy popunjavanje, uvedeno ujutru, uklonjeno je uveče (`20260919140000`), jer feed
nije broker na kom je backtest rađen.

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

Odgovor na to pitanje (19.09.2026): ni jedan od tri kandidata u tom obliku. Za trading naloge MT5
terminal se čita direktno, preko Python paketa `MetaTrader5`, bez EA i bez ručnog izvoza. Za backtest
naloge vrednost unosi trgovac.
