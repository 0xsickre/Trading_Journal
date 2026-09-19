"""MAE/MFE for closed trades on TRADING accounts, from the local MT5 terminal.

    python scripts/mt5_excursion.py            fill what is missing
    python scripts/mt5_excursion.py --dry-run  compute and print, write nothing
    python scripts/mt5_excursion.py --recompute  also redo values MT5 wrote before

What it needs, and nothing more:

  - An MT5 terminal on this computer, logged in to ANY FTMO account. Only its
    PRICES are used, by symbol and time. The account number never matters, so
    a new free trial or challenge needs no change here. Nothing is traded:
    the script calls no order function.
  - `.env.local` in the project root with NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY, JOURNAL_EMAIL and JOURNAL_PASSWORD. It signs
    in as the journal's user, so row-level security applies exactly as in the
    app. No value from that file is ever printed.

Which trades, and why each exclusion:

  - account_kind = 'trading' only. Backtest MAE/MFE is typed by hand.
  - closed only. An open trade has no last exit to scan up to.
  - never over a MANUAL value: excursion_source = 'manual', or prices present
    with no source (typed before the column existed), are the trader's.
  - by default not over an earlier 'mt5' value either; --recompute redoes those,
    e.g. after a fill was corrected.

How a trade is measured:

  - FTMO's server clock is New York + 7 hours (UTC+3 in summer, UTC+2 in
    winter; the New York open prints at 16:30). The journal stores UTC; every
    request to the terminal is shifted into server time and back.
  - A long is valued at the BID, a short at the ASK — the prices each would
    close at, the same way MT5 shows a position's floating result.
  - Each fill is located among the ticks around its time: the tick whose
    relevant side (ask for buying, bid for selling) is closest to the fill
    price. A fill stamped to the minute is searched in that minute. If no tick
    comes within 0.05% of the fill, the trade is refused instead of guessed,
    since the time, the zone or the symbol is wrong.
  - Between the entry tick and the last exit tick every tick counts, and the
    fill prices themselves count too.
  - Ticks go back about two years. Older trades fall back to 1-minute bars
    (bid; the ask is the bid plus the bar's spread). Those count only full
    minutes strictly inside the trade.

Every skipped trade is printed with its reason.
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np

try:
    import MetaTrader5 as mt5
except ImportError:  # pragma: no cover
    sys.exit("The MetaTrader5 package is missing: pip install MetaTrader5 numpy")

ROOT = Path(__file__).resolve().parent.parent

# Journal instrument → FTMO MT5 symbol.
SYMBOLS = {
    "NAS100": "US100.cash",
    "US100": "US100.cash",
    "XAUUSD": "XAUUSD",
    "XCUUSD": "XCUUSD",
    "HG": "XCUUSD",
}

# How far a fill may sit from the nearest tick's price (slippage and rounding)
# before the trade is refused as the wrong time or symbol.
FILL_TOLERANCE = 0.0005
MINUTE_MS = 60_000
# Ticks are fetched in slices so a week-long trade on gold (~100k ticks a day)
# never sits in memory at once.
SLICE = timedelta(hours=6)


# --- time: UTC <-> FTMO server time -----------------------------------------


def _nth_sunday(year: int, month: int, n: int) -> datetime:
    d = datetime(year, month, 1, tzinfo=timezone.utc)
    d += timedelta(days=(6 - d.weekday()) % 7)
    return d + timedelta(weeks=n - 1)


def server_offset(utc: datetime) -> timedelta:
    """FTMO server time minus UTC at `utc`: New York's offset plus 7 hours.

    US daylight time runs from 02:00 local on the second Sunday of March (07:00
    UTC) to 02:00 local on the first Sunday of November (06:00 UTC).
    """
    start = _nth_sunday(utc.year, 3, 2) + timedelta(hours=7)
    end = _nth_sunday(utc.year, 11, 1) + timedelta(hours=6)
    ny = -4 if start <= utc < end else -5
    return timedelta(hours=ny + 7)


def to_server(utc: datetime) -> datetime:
    """A UTC instant as the terminal's clock reads it, in the tz-aware form the
    MetaTrader5 package expects (it treats the value as its own clock)."""
    return utc + server_offset(utc)


def server_ms_to_utc_ms(ms: int) -> int:
    approx = datetime.fromtimestamp(ms / 1000, tz=timezone.utc)
    off = server_offset(approx - timedelta(hours=3))
    return ms - int(off.total_seconds() * 1000)


# --- Supabase ----------------------------------------------------------------


def read_env_local() -> dict[str, str]:
    path = ROOT / ".env.local"
    if not path.exists():
        sys.exit(f"{path} is missing")
    env: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        env[key.strip()] = value.strip().strip('"').strip("'")
    needed = [
        "NEXT_PUBLIC_SUPABASE_URL",
        "NEXT_PUBLIC_SUPABASE_ANON_KEY",
        "JOURNAL_EMAIL",
        "JOURNAL_PASSWORD",
    ]
    missing = [k for k in needed if not env.get(k)]
    if missing:
        sys.exit(f".env.local has no value for: {', '.join(missing)}")
    return env


class Journal:
    def __init__(self, env: dict[str, str]):
        self.url = env["NEXT_PUBLIC_SUPABASE_URL"].rstrip("/")
        self.key = env["NEXT_PUBLIC_SUPABASE_ANON_KEY"]
        res = self._call(
            "POST",
            "/auth/v1/token?grant_type=password",
            {"email": env["JOURNAL_EMAIL"], "password": env["JOURNAL_PASSWORD"]},
            auth=False,
        )
        self.token = res["access_token"]

    def _call(self, method: str, path: str, body=None, auth=True, extra=None):
        headers = {"apikey": self.key, "Content-Type": "application/json"}
        if auth:
            headers["Authorization"] = f"Bearer {self.token}"
        headers.update(extra or {})
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(self.url + path, data=data, method=method, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                raw = r.read()
        except urllib.error.HTTPError as e:
            # The body names the problem; it never holds the credentials.
            detail = e.read().decode(errors="replace")[:300]
            raise RuntimeError(f"{method} {path.split('?')[0]} -> HTTP {e.code}: {detail}") from None
        return json.loads(raw) if raw else None

    def get(self, table: str, query: dict[str, str]):
        return self._call("GET", f"/rest/v1/{table}?{urllib.parse.urlencode(query)}")

    def patch(self, table: str, row_id: str, values: dict):
        self._call(
            "PATCH",
            f"/rest/v1/{table}?id=eq.{row_id}",
            values,
            extra={"Prefer": "return=minimal"},
        )


# --- measuring ---------------------------------------------------------------


@dataclass
class Fill:
    side: str  # entry | exit
    price: float
    at_ms: int  # UTC


@dataclass
class Result:
    mae: float
    mfe: float
    source: str  # "ticks" | "M1"


class Refused(Exception):
    pass


def _ticks(symbol: str, frm_utc_ms: int, to_utc_ms: int):
    """Ticks between two UTC instants, with times converted back to UTC ms."""
    frm = datetime.fromtimestamp(frm_utc_ms / 1000, tz=timezone.utc)
    to = datetime.fromtimestamp(to_utc_ms / 1000, tz=timezone.utc)
    parts = []
    t = frm
    while t < to:
        u = min(t + SLICE, to)
        chunk = mt5.copy_ticks_range(symbol, to_server(t), to_server(u), mt5.COPY_TICKS_INFO)
        if chunk is not None and len(chunk):
            parts.append(chunk)
        t = u
    if not parts:
        return None
    ticks = np.concatenate(parts)
    utc_ms = np.array([server_ms_to_utc_ms(int(x)) for x in ticks["time_msc"]], dtype=np.int64)
    keep = (utc_ms >= frm_utc_ms) & (utc_ms <= to_utc_ms)
    return utc_ms[keep], ticks["bid"][keep], ticks["ask"][keep]


def _locate(fill: Fill, buying: bool, times, bids, asks) -> int:
    """UTC ms of the tick that printed this fill."""
    if fill.at_ms % MINUTE_MS == 0:
        lo, hi = fill.at_ms - 1_000, fill.at_ms + MINUTE_MS
    else:
        lo, hi = fill.at_ms - 3_000, fill.at_ms + 3_000
    mask = (times >= lo) & (times < hi) & (bids > 0) & (asks > 0)
    if not mask.any():
        raise Refused(f"no ticks around the {fill.side} at {_fmt(fill.at_ms)} UTC")
    side_prices = (asks if buying else bids)[mask]
    dist = np.abs(side_prices - fill.price)
    i = int(np.argmin(dist))
    if dist[i] > FILL_TOLERANCE * fill.price:
        near = float(side_prices[i])
        hint = " - the price scale differs from the terminal's" if near and not 0.2 < fill.price / near < 5 else ""
        raise Refused(
            f"the {fill.side} at {fill.price} was not traded around {_fmt(fill.at_ms)} UTC "
            f"(nearest {near}){hint}; check the time, its zone and the symbol"
        )
    return int(times[mask][i])


def _fmt(ms: int) -> str:
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).strftime("%d/%m/%Y %H:%M:%S")


def measure(symbol: str, fills: list[Fill], is_short: bool) -> Result:
    entries = [f for f in fills if f.side == "entry"]
    exits = [f for f in fills if f.side == "exit"]
    if not entries or not exits:
        raise Refused("no entry and exit fills to measure between")
    # The journal may quote in other units than the terminal: FTMO's copper is
    # in cents per pound (656.4), TradingView's in dollars (6.564). The factor
    # is read off the price level, which a hundredfold gap cannot be confused
    # with, and everything is measured in terminal units and converted back.
    k = _unit_factor(symbol, entries[0])
    if k != 1:
        fills = [Fill(f.side, f.price * k, f.at_ms) for f in fills]
        entries = [f for f in fills if f.side == "entry"]
        exits = [f for f in fills if f.side == "exit"]
        r = _measure(symbol, fills, entries, exits, is_short)
        digits = mt5.symbol_info(symbol).digits + round(np.log10(k))
        return Result(round(r.mae / k, digits), round(r.mfe / k, digits), r.source)
    return _measure(symbol, fills, entries, exits, is_short)


def _unit_factor(symbol: str, entry: Fill) -> float:
    at = datetime.fromtimestamp(entry.at_ms / 1000, tz=timezone.utc)
    bars = mt5.copy_rates_from(symbol, mt5.TIMEFRAME_D1, to_server(at), 1)
    if bars is None or not len(bars):
        return 1
    ratio = float(bars[0]["close"]) / entry.price
    for k in (100.0, 0.01):
        if 0.5 * k < ratio < 2 * k:
            return k
    return 1


def _measure(symbol: str, fills: list[Fill], entries: list[Fill], exits: list[Fill], is_short: bool) -> Result:
    first = min(f.at_ms for f in fills)
    last = max(f.at_ms for f in fills)
    prices = [f.price for f in fills]

    ticks = _ticks(symbol, first - 5_000, last + MINUTE_MS + 5_000)
    if ticks is not None and len(ticks[0]):
        times, bids, asks = ticks
        # A long buys at the ask to enter and sells at the bid to exit; a short
        # the other way round.
        start = min(_locate(f, not is_short, times, bids, asks) for f in entries)
        end = max(_locate(f, is_short, times, bids, asks) for f in exits)
        if end < start:
            raise Refused("the last exit comes before the entry")
        inside = (times >= start) & (times <= end)
        valued = (asks if is_short else bids)[inside]
        valued = valued[valued > 0]
        low = min([float(valued.min())] + prices) if len(valued) else min(prices)
        high = max([float(valued.max())] + prices) if len(valued) else max(prices)
        source = "ticks"
    else:
        low, high = _minute_extremes(symbol, first, last, is_short, prices)
        source = "M1"

    return Result(
        mae=high if is_short else low,
        mfe=low if is_short else high,
        source=source,
    )


def _minute_extremes(symbol: str, first: int, last: int, is_short: bool, prices: list[float]):
    """Older than the tick history: 1-minute bars strictly between the fills."""
    frm = datetime.fromtimestamp(first / 1000, tz=timezone.utc)
    to = datetime.fromtimestamp(last / 1000, tz=timezone.utc)
    bars = mt5.copy_rates_range(symbol, mt5.TIMEFRAME_M1, to_server(frm), to_server(to))
    if bars is None:
        raise Refused("the terminal has neither ticks nor 1-minute bars for that time")
    point = mt5.symbol_info(symbol).point
    low, high = min(prices), max(prices)
    first_min = first - first % MINUTE_MS
    last_min = last - last % MINUTE_MS
    for b in bars:
        t = server_ms_to_utc_ms(int(b["time"]) * 1000)
        if t <= first_min or t >= last_min:
            continue
        add = b["spread"] * point if is_short else 0.0
        low = min(low, b["low"] + add)
        high = max(high, b["high"] + add)
    return low, high


# --- main --------------------------------------------------------------------


def clock_agrees() -> bool:
    """The terminal's clock against the New York + 7 rule, on the freshest tick.

    Every time conversion rests on that rule. A terminal logged in to a broker
    on another clock would shift every trade by hours, so this refuses to run
    rather than fill anything.
    """
    newest = None
    for symbol in set(SYMBOLS.values()):
        mt5.symbol_select(symbol, True)
        tick = mt5.symbol_info_tick(symbol)
        if tick and tick.time and (newest is None or tick.time > newest):
            newest = tick.time
    now = datetime.now(timezone.utc)
    if newest is None:
        return True
    # How old the newest tick is, if the rule is right. A clock AHEAD of the
    # rule shows as a tick from the future; one BEHIND as a tick an hour or more
    # old while gold is trading. Outside those hours (a weekend, gold's daily
    # break around 21:00 UTC) a stale tick proves nothing, and the rule stands.
    age = now.timestamp() - (newest - server_offset(now).total_seconds())
    trading_hours = now.weekday() < 5 and not (20 <= now.hour < 24) and not (now.weekday() == 0 and now.hour < 1)
    if age < -120 or (trading_hours and 45 * 60 < age < 6 * 3600):
        print(
            f"The terminal's clock is {-age / 3600:+.1f} h off FTMO's New York + 7 - "
            "is it logged in to an FTMO account? Nothing was filled."
        )
        return False
    return True


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--dry-run", action="store_true", help="compute and print, write nothing")
    ap.add_argument("--recompute", action="store_true", help="also redo values MT5 wrote before")
    args = ap.parse_args()

    journal = Journal(read_env_local())

    if not mt5.initialize():
        print(f"MT5 terminal not reachable: {mt5.last_error()}")
        return 1
    try:
        if not clock_agrees():
            return 1
        accounts = journal.get("tj_accounts", {"select": "id", "account_kind": "eq.trading"})
        ids = [a["id"] for a in accounts]
        if not ids:
            print("No trading accounts in the journal - nothing to fill.")
            return 0
        positions = journal.get(
            "tj_positions",
            {
                "select": "id,trade_no,instrument,direction,status,max_drawdown_price,max_profit_price,excursion_source",
                "account_id": f"in.({','.join(ids)})",
                "status": "eq.closed",
                "order": "trade_no",
            },
        )
        filled, skipped = 0, 0
        for p in positions:
            label = f"#{p['trade_no']} {p['instrument'] or '?'}"
            src = p["excursion_source"]
            has_values = p["max_drawdown_price"] is not None or p["max_profit_price"] is not None
            if src == "manual" or (src is None and has_values):
                continue  # the trader's; not even worth a line
            if src == "mt5" and not args.recompute:
                continue
            try:
                symbol = SYMBOLS.get((p["instrument"] or "").upper())
                if not symbol:
                    raise Refused(f"no MT5 symbol mapped for {p['instrument']}")
                if not mt5.symbol_select(symbol, True) or mt5.symbol_info(symbol) is None:
                    raise Refused(f"the terminal has no symbol {symbol}")
                execs = journal.get(
                    "tj_executions",
                    {"select": "side,price,executed_at", "position_id": f"eq.{p['id']}"},
                )
                fills = [
                    Fill(
                        e["side"],
                        float(e["price"]),
                        int(datetime.fromisoformat(e["executed_at"]).timestamp() * 1000),
                    )
                    for e in execs
                    if e["side"] in ("entry", "exit") and e["price"] is not None
                ]
                is_short = (p["direction"] or "").lower().startswith("short")
                r = measure(symbol, fills, is_short)
            except Refused as e:
                skipped += 1
                print(f"skip  {label}: {e}")
                continue
            if not args.dry_run:
                journal.patch(
                    "tj_positions",
                    p["id"],
                    {"max_drawdown_price": r.mae, "max_profit_price": r.mfe, "excursion_source": "mt5"},
                )
            filled += 1
            print(f"{'would fill' if args.dry_run else 'fill'}  {label}: MAE {r.mae}  MFE {r.mfe}  ({r.source})")
        print(f"\n{filled} {'would be ' if args.dry_run else ''}filled, {skipped} skipped.")
        return 0
    finally:
        mt5.shutdown()


if __name__ == "__main__":
    sys.exit(main())
