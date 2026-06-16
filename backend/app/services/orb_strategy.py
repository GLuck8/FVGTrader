"""
ORB-FVG (Opening Range Breakout + Fair Value Gap) strategy engine.

Rules:
1. At 9:30 AM ET, define the opening range (OR) as the high/low of the
   9:30–9:34 M1 candles (5 bars = the first 5-minute candle of the session).
2. After 9:34, scan M1 candles for the first breakout:
   - Bullish: close > OR high AND large body (body_pct >= min_body_pct)
   - Bearish: close < OR low  AND large body
3. The breakout candle is C2 (centre) of an FVG:
   - Bullish: fvg_bottom = C1.high, fvg_top = C3.low  (gap must be positive)
   - Bearish: fvg_top = C1.low,    fvg_bottom = C3.high
4. Wait up to max_wait_bars for price to retest the FVG zone, then enter
   on a candle whose body engulfs the previous candle in the trend direction.
5. Stop = lowest retest low − buffer (bull) / highest retest high + buffer (bear).
6. Target = entry ± risk × rr_ratio.

Pure functions — no I/O.
"""

import logging
from datetime import date as Date
from typing import Optional
from zoneinfo import ZoneInfo

from app.models.schemas import (
    Candle, FVGDirection,
    ORBParams, ORBStatus, ORBEntrySignal, ORBDailySetup,
    BacktestTrade, BacktestStats,
)
from app.services.strategy import _close_trade, compute_stats

log = logging.getLogger(__name__)

ET = ZoneInfo("America/New_York")


# ── Public API ────────────────────────────────────────────────────────────────

def analyse_today(
    candles_m1: list[Candle],
    instrument: str,
    params: ORBParams,
) -> ORBDailySetup:
    """
    Run ORB detection on the supplied M1 candles and return today's setup status.
    Pass ~200 recent M1 candles (covers a full session plus some prior context).
    """
    today = candles_m1[-1].time.astimezone(ET).date() if candles_m1 else None
    if not today:
        return ORBDailySetup(instrument=instrument, date="", status=ORBStatus.NO_SETUP)

    day_candles = [c for c in candles_m1 if c.time.astimezone(ET).date() == today]
    return _run_day(instrument, today, day_candles, params)


def backtest_orb(
    instrument: str,
    candles_m1: list[Candle],
    params: ORBParams,
    starting_capital: float = 10_000.0,
) -> tuple[list[BacktestTrade], list[float], list[ORBDailySetup]]:
    """
    Simulate the ORB-FVG strategy on historical M1 candles.
    Returns (trades, equity_curve, daily_setups).
    """
    days = _group_by_day(candles_m1)
    trades: list[BacktestTrade] = []
    equity_curve: list[float]   = [starting_capital]
    capital = starting_capital
    daily_setups: list[ORBDailySetup] = []

    for day, day_candles in sorted(days.items()):
        setup = _run_day(instrument, day, day_candles, params)
        daily_setups.append(setup)

        if setup.status != ORBStatus.ENTRY_SIGNAL or setup.signal is None:
            continue

        sig  = setup.signal
        risk = sig.risk
        if risk <= 0:
            continue

        # Position size
        risk_dollars = capital * (params.risk_pct / 100)
        size = round(risk_dollars / risk, 4)

        trade = BacktestTrade(
            instrument   = instrument,
            direction    = setup.direction,
            entry        = sig.entry,
            stop         = sig.stop,
            target       = sig.target,
            size         = size,
            entry_time   = sig.entry_time,
            ob_protected = False,
        )

        # Simulate forward from entry bar
        entry_idx = next(
            (i for i, c in enumerate(day_candles) if c.time >= sig.entry_time),
            None,
        )
        if entry_idx is None:
            continue

        for j in range(entry_idx + 1, len(day_candles)):
            bar = day_candles[j]
            if setup.direction == FVGDirection.BULLISH:
                if bar.low <= sig.stop:
                    _close_trade(trade, sig.stop, bar.time, "stop")
                    break
                if bar.high >= sig.target:
                    _close_trade(trade, sig.target, bar.time, "target")
                    break
            else:
                if bar.high >= sig.stop:
                    _close_trade(trade, sig.stop, bar.time, "stop")
                    break
                if bar.low <= sig.target:
                    _close_trade(trade, sig.target, bar.time, "target")
                    break
        else:
            # Close at EOD
            if trade.exit_price is None and day_candles:
                _close_trade(trade, day_candles[-1].close, day_candles[-1].time, "expired")

        if trade.pnl is not None:
            capital += trade.pnl
            trades.append(trade)
            equity_curve.append(round(capital, 2))

    return trades, equity_curve, daily_setups


# ── Core detection logic ──────────────────────────────────────────────────────

def _run_day(
    instrument: str,
    day: Date,
    day_candles: list[Candle],
    params: ORBParams,
) -> ORBDailySetup:
    """Run the full ORB pipeline on a single day's M1 candles."""
    date_str = day.strftime("%Y-%m-%d")
    base = dict(instrument=instrument, date=date_str)

    # Step 1 — opening range
    or_result = _get_opening_range(day_candles)
    if or_result is None:
        return ORBDailySetup(**base, status=ORBStatus.NO_SETUP)

    or_high, or_low, or_end_idx = or_result

    # Step 2 — breakout
    breakout = _detect_breakout(day_candles, or_high, or_low, or_end_idx, params)
    if breakout is None:
        return ORBDailySetup(
            **base,
            status               = ORBStatus.WAITING_FOR_BREAKOUT,
            opening_range_high   = or_high,
            opening_range_low    = or_low,
            range_size           = round(or_high - or_low, 5),
        )

    direction, breakout_idx, breakout_body_pct = breakout

    # Step 3 — FVG
    fvg = _build_fvg(day_candles, breakout_idx, direction)
    if fvg is None:
        return ORBDailySetup(
            **base,
            status               = ORBStatus.NO_SETUP,
            opening_range_high   = or_high,
            opening_range_low    = or_low,
            range_size           = round(or_high - or_low, 5),
            direction            = direction,
            breakout_price       = day_candles[breakout_idx].close,
            breakout_time        = day_candles[breakout_idx].time,
            breakout_body_pct    = round(breakout_body_pct, 3),
        )

    fvg_top, fvg_bottom = fvg

    # Step 4 — retest + engulfing
    signal = _detect_retest_entry(day_candles, fvg_top, fvg_bottom, direction,
                                   breakout_idx + 2, params)

    status = ORBStatus.ENTRY_SIGNAL if signal else ORBStatus.FVG_FORMED

    return ORBDailySetup(
        **base,
        status               = status,
        opening_range_high   = or_high,
        opening_range_low    = or_low,
        range_size           = round(or_high - or_low, 5),
        direction            = direction,
        breakout_price       = day_candles[breakout_idx].close,
        breakout_time        = day_candles[breakout_idx].time,
        breakout_body_pct    = round(breakout_body_pct, 3),
        fvg_top              = fvg_top,
        fvg_bottom           = fvg_bottom,
        fvg_midpoint         = round((fvg_top + fvg_bottom) / 2, 5),
        signal               = signal,
    )


def _get_opening_range(
    day_candles: list[Candle],
) -> Optional[tuple[float, float, int]]:
    """
    Find the 9:30–9:34 ET opening range from M1 candles.
    Returns (or_high, or_low, last_or_bar_index) or None.
    Requires at least 3 of the 5 expected candles to be present.
    """
    or_bars: list[tuple[int, Candle]] = []
    for i, c in enumerate(day_candles):
        lt = c.time.astimezone(ET)
        if lt.hour == 9 and 30 <= lt.minute <= 34:
            or_bars.append((i, c))

    if len(or_bars) < 3:
        return None

    or_high = max(c.high for _, c in or_bars)
    or_low  = min(c.low  for _, c in or_bars)
    last_idx = or_bars[-1][0]
    return or_high, or_low, last_idx


def _detect_breakout(
    day_candles: list[Candle],
    or_high: float,
    or_low: float,
    or_end_idx: int,
    params: ORBParams,
) -> Optional[tuple[FVGDirection, int, float]]:
    """
    Find the first M1 candle after the opening range that breaks out with a
    large body.  Returns (direction, bar_index, body_pct) or None.
    """
    for i in range(or_end_idx + 1, len(day_candles)):
        c = day_candles[i]
        candle_range = c.high - c.low
        if candle_range == 0:
            continue
        body     = abs(c.close - c.open)
        body_pct = body / candle_range
        if body_pct < params.min_body_pct:
            continue

        # Bullish breakout: close above OR high with bullish body
        if c.close > or_high and c.close > c.open:
            return FVGDirection.BULLISH, i, body_pct

        # Bearish breakout: close below OR low with bearish body
        if c.close < or_low and c.close < c.open:
            return FVGDirection.BEARISH, i, body_pct

    return None


def _build_fvg(
    day_candles: list[Candle],
    breakout_idx: int,
    direction: FVGDirection,
) -> Optional[tuple[float, float]]:
    """
    Build an FVG from the breakout candle (C2) and its neighbours (C1, C3).
    Returns (fvg_top, fvg_bottom) or None if no valid gap.
    """
    if breakout_idx == 0 or breakout_idx >= len(day_candles) - 1:
        return None

    c1 = day_candles[breakout_idx - 1]
    c3 = day_candles[breakout_idx + 1]

    if direction == FVGDirection.BULLISH:
        # Gap: C1 wick top to C3 wick bottom
        fvg_bottom = c1.high
        fvg_top    = c3.low
    else:
        # Gap: C3 wick top to C1 wick bottom
        fvg_top    = c1.low
        fvg_bottom = c3.high

    if fvg_top <= fvg_bottom:
        return None  # no valid gap (candles overlap)

    return round(fvg_top, 5), round(fvg_bottom, 5)


def _detect_retest_entry(
    day_candles: list[Candle],
    fvg_top: float,
    fvg_bottom: float,
    direction: FVGDirection,
    start_idx: int,
    params: ORBParams,
) -> Optional[ORBEntrySignal]:
    """
    After the FVG forms, scan forward for:
      1. Price touching the FVG zone (retest candles)
      2. An engulfing candle in the trend direction that closes beyond the
         previous candle's body — this is the entry trigger.

    Returns ORBEntrySignal or None.
    """
    fvg_size = fvg_top - fvg_bottom

    # Sliding window: track the last 2 candles that are at/near the zone
    recent: list[Candle] = []
    retest_lows: list[float]  = []
    retest_highs: list[float] = []

    end_idx = min(start_idx + params.max_wait_bars, len(day_candles))

    for i in range(start_idx, end_idx):
        c = day_candles[i]
        in_zone = c.low <= fvg_top and c.high >= fvg_bottom

        if in_zone:
            retest_lows.append(c.low)
            retest_highs.append(c.high)
            recent.append(c)

            # Need at least 2 candles inside/touching the zone to check engulfing
            if len(recent) >= 2:
                prev = recent[-2]
                curr = recent[-1]

                if direction == FVGDirection.BULLISH:
                    # Bullish engulfing: prev bearish, curr bullish body > prev body, closes above prev open
                    if (prev.close < prev.open          # prev is bearish
                            and curr.close > curr.open  # curr is bullish
                            and curr.close > prev.open):  # engulfs

                        entry  = curr.close
                        stop   = min(retest_lows) - fvg_size * params.stop_buffer_pct
                        risk   = entry - stop
                        target = entry + risk * params.rr_ratio
                        if risk > 0:
                            return ORBEntrySignal(
                                entry      = round(entry,  5),
                                stop       = round(stop,   5),
                                target     = round(target, 5),
                                entry_time = curr.time,
                                risk       = round(risk,   5),
                                reward     = round(risk * params.rr_ratio, 5),
                            )

                else:  # BEARISH
                    # Bearish engulfing: prev bullish, curr bearish body > prev body, closes below prev open
                    if (prev.close > prev.open          # prev is bullish
                            and curr.close < curr.open  # curr is bearish
                            and curr.close < prev.open):  # engulfs

                        entry  = curr.close
                        stop   = max(retest_highs) + fvg_size * params.stop_buffer_pct
                        risk   = stop - entry
                        target = entry - risk * params.rr_ratio
                        if risk > 0:
                            return ORBEntrySignal(
                                entry      = round(entry,  5),
                                stop       = round(stop,   5),
                                target     = round(target, 5),
                                entry_time = curr.time,
                                risk       = round(risk,   5),
                                reward     = round(risk * params.rr_ratio, 5),
                            )
        else:
            # Price has moved away from the zone; keep recent list small
            # (allow returning for a second retest)
            if len(recent) > 10:
                recent = recent[-2:]

    return None


# ── Helpers ───────────────────────────────────────────────────────────────────

def _group_by_day(candles: list[Candle]) -> dict[Date, list[Candle]]:
    """Group M1 candles by calendar date in ET."""
    days: dict[Date, list[Candle]] = {}
    for c in candles:
        d = c.time.astimezone(ET).date()
        days.setdefault(d, []).append(c)
    # Sort within each day
    return {k: sorted(v, key=lambda c: c.time) for k, v in days.items()}
