"""
FVG + Order Block strategy engine.

Pure functions — no I/O, no side effects.
Takes a list of Candle objects, returns zones and signals.
"""

import logging
from datetime import datetime
from typing import Optional

from app.models.schemas import (
    Candle, FVGZone, FVGDirection, OrderBlock, StrategyParams,
    BacktestTrade, BacktestStats, BacktestResult, BacktestRequest,
)

log = logging.getLogger(__name__)


# ── Order Block Detection ─────────────────────────────────────────────────────

def detect_order_blocks(
    candles: list[Candle],
    lookback: int = 20,
    min_body_pct: float = 0.6,
) -> list[OrderBlock]:
    """
    Identify order blocks — the last strong opposing candle before a large move.

    A bullish order block is the last bearish candle before a strong upward move
    (institutional buy zone). A bearish order block is the last bullish candle
    before a strong downward move (institutional sell zone).

    min_body_pct: minimum (body / candle range) to qualify as a strong candle.
    lookback: only return OBs formed within this many bars of the most recent candle.
    """
    obs: list[OrderBlock] = []
    min_bar = max(0, len(candles) - lookback - 1)  # only care about recent OBs

    lookahead = 5  # bars to scan for follow-through move

    for i in range(0, len(candles) - 1):
        if i < min_bar:
            continue  # too old to be a relevant OB
        curr = candles[i]

        candle_range = curr.high - curr.low
        if candle_range == 0:
            continue
        body = abs(curr.close - curr.open)
        body_pct = body / candle_range

        if body_pct < min_body_pct:
            continue

        # Check follow-through over the next `lookahead` bars instead of
        # requiring the immediate next candle to close beyond the extreme.
        # This fixes the OB filter returning zero results.
        future = candles[i + 1 : min(i + 1 + lookahead, len(candles))]

        # Bullish OB: strong bearish candle → any of the next bars closes above its high
        if curr.close < curr.open:
            if any(c.close > curr.high for c in future):
                obs.append(OrderBlock(
                    direction  = FVGDirection.BULLISH,
                    top        = curr.open,   # top of bearish candle body
                    bottom     = curr.close,  # bottom of bearish candle body
                    bar_index  = i,
                    timestamp  = curr.time,
                    strength   = body_pct,
                ))

        # Bearish OB: strong bullish candle → any of the next bars closes below its low
        elif curr.close > curr.open:
            if any(c.close < curr.low for c in future):
                obs.append(OrderBlock(
                    direction  = FVGDirection.BEARISH,
                    top        = curr.close,  # top of bullish candle body
                    bottom     = curr.open,   # bottom of bullish candle body
                    bar_index  = i,
                    timestamp  = curr.time,
                    strength   = body_pct,
                ))

    return obs


def find_protecting_ob(
    zone: FVGZone,
    obs: list[OrderBlock],
) -> Optional[OrderBlock]:
    """
    Return the order block that "protects" an FVG, if one exists.

    A bullish FVG is protected by a bullish OB that sits at or below the gap —
    meaning institutional demand is clustered below the entry, supporting the move.
    A bearish FVG is protected by a bearish OB at or above the gap.
    """
    for ob in obs:
        if ob.bar_index >= zone.bar_index:
            continue  # OB must precede the FVG

        if zone.direction == FVGDirection.BULLISH and ob.direction == FVGDirection.BULLISH:
            # OB should be at or below the FVG bottom
            if ob.top <= zone.top and ob.bottom >= zone.bottom * 0.85:
                return ob

        elif zone.direction == FVGDirection.BEARISH and ob.direction == FVGDirection.BEARISH:
            # OB should be at or above the FVG top
            if ob.bottom >= zone.bottom and ob.top <= zone.top * 1.15:
                return ob

    return None


# ── FVG Detection ─────────────────────────────────────────────────────────────

def detect_fvgs(
    candles: list[Candle],
    instrument: str,
    timeframe: str,
    params: StrategyParams,
) -> list[FVGZone]:
    """
    Scan candles for Fair Value Gaps.
    Each FVG is defined by 3 consecutive candles where C1 and C3 wicks don't overlap.
    Optionally checks for order block protection.
    """
    zones: list[FVGZone] = []

    # Detect order blocks first if the filter is enabled
    obs: list[OrderBlock] = []
    if params.ob_filter_enabled:
        obs = detect_order_blocks(
            candles,
            lookback    = params.ob_lookback,
            min_body_pct= params.ob_min_body_pct,
        )

    # Compute EMA for trend filter
    ema: list[float] = []
    if params.trend_filter_enabled:
        ema = _compute_ema(candles, params.trend_ema_period)

    for i in range(2, len(candles)):
        c1 = candles[i - 2]
        c2 = candles[i - 1]
        c3 = candles[i]

        mid_price = c2.close

        # ── Bullish FVG: C3 low > C1 high ────────────────────────────────
        gap_bottom = c1.high
        gap_top    = c3.low
        if gap_top > gap_bottom:
            gap_pct = (gap_top - gap_bottom) / mid_price
            if gap_pct >= params.min_gap_pct:

                # Trend filter: only bullish FVGs above EMA
                if params.trend_filter_enabled and ema and i < len(ema):
                    if c3.close < ema[i]:
                        continue  # price below EMA, skip bullish setup

                zone = FVGZone(
                    instrument = instrument,
                    direction  = FVGDirection.BULLISH,
                    top        = gap_top,
                    bottom     = gap_bottom,
                    midpoint   = (gap_top + gap_bottom) / 2,
                    gap_pct    = gap_pct,
                    bar_index  = i,
                    timestamp  = c3.time,
                    timeframe  = timeframe,
                )

                # Check OB protection
                if params.ob_filter_enabled:
                    protecting_ob = find_protecting_ob(zone, obs)
                    if protecting_ob:
                        zone.ob_protected = True
                        zone.ob_price     = protecting_ob.bottom

                zones.append(zone)

        # ── Bearish FVG: C3 high < C1 low ────────────────────────────────
        gap_top    = c1.low
        gap_bottom = c3.high
        if gap_top > gap_bottom:
            gap_pct = (gap_top - gap_bottom) / mid_price
            if gap_pct >= params.min_gap_pct:

                # Trend filter: only bearish FVGs below EMA
                if params.trend_filter_enabled and ema and i < len(ema):
                    if c3.close > ema[i]:
                        continue  # price above EMA, skip bearish setup

                zone = FVGZone(
                    instrument = instrument,
                    direction  = FVGDirection.BEARISH,
                    top        = gap_top,
                    bottom     = gap_bottom,
                    midpoint   = (gap_top + gap_bottom) / 2,
                    gap_pct    = gap_pct,
                    bar_index  = i,
                    timestamp  = c3.time,
                    timeframe  = timeframe,
                )

                if params.ob_filter_enabled:
                    protecting_ob = find_protecting_ob(zone, obs)
                    if protecting_ob:
                        zone.ob_protected = True
                        zone.ob_price     = protecting_ob.top

                zones.append(zone)

    return zones


# ── Backtester ────────────────────────────────────────────────────────────────

def run_backtest(
    instrument: str,
    candles: list[Candle],
    timeframe: str,
    params: StrategyParams,
    starting_capital: float = 10_000.0,
    compound: bool = False,
) -> tuple[list[BacktestTrade], list[float]]:
    """
    Simulate FVG entries on a candle series.
    Returns (trades, equity_curve).

    compound=False (default): position size always based on starting_capital.
        Shows the strategy's real edge without exponential reinvestment distortion.
    compound=True: each win increases the capital used for sizing (realistic for
        accounts that reinvest all profits, but can produce astronomical P&L).
    """
    zones = detect_fvgs(candles, instrument, timeframe, params)

    trades: list[BacktestTrade] = []
    equity_curve: list[float]   = [starting_capital]
    capital = starting_capital
    last_signal_bar = -999

    for zone in zones:
        entry_bar = zone.bar_index

        # Minimum bar separation
        if entry_bar - last_signal_bar < params.min_bars_between_signals:
            continue

        # OB filter: skip unprotected zones if the filter is enabled
        if params.ob_filter_enabled and not zone.ob_protected:
            continue

        # Calculate prices
        entry_pct = params.entry_pct
        stop_buf  = params.stop_buffer_pct
        gap_size  = zone.top - zone.bottom

        if zone.direction == FVGDirection.BULLISH:
            entry  = zone.top  - gap_size * entry_pct
            stop   = zone.bottom - gap_size * stop_buf
            risk   = entry - stop
            target = entry + risk * params.rr_ratio
        else:
            entry  = zone.bottom + gap_size * entry_pct
            stop   = zone.top    + gap_size * stop_buf
            risk   = stop - entry
            target = entry - risk * params.rr_ratio

        if risk <= 0:
            continue

        # Position size: use running capital if compounding, starting capital otherwise.
        # Non-compounding (default) shows real edge without exponential distortion.
        sizing_capital = capital if compound else starting_capital
        risk_dollars   = sizing_capital * (params.risk_pct / 100)
        size           = round(risk_dollars / risk, 4)

        # Scan forward for trigger + exit
        triggered = False
        trade: Optional[BacktestTrade] = None
        trail_extreme = entry  # tracks best price seen once in trade (for trailing stop)

        for j in range(entry_bar + 1, min(entry_bar + params.max_age_bars + 1, len(candles))):
            bar = candles[j]

            if not triggered:
                entered = (
                    (zone.direction == FVGDirection.BULLISH and bar.low <= entry) or
                    (zone.direction == FVGDirection.BEARISH and bar.high >= entry)
                )
                if entered:
                    triggered = True
                    trail_extreme = entry
                    trade = BacktestTrade(
                        instrument   = instrument,
                        direction    = zone.direction,
                        entry        = entry,
                        stop         = stop,
                        target       = target,
                        size         = size,
                        entry_time   = bar.time,
                        timeframe    = timeframe,
                        ob_protected = zone.ob_protected,
                    )
                    last_signal_bar = j
                    # ── FIX 1: also check stop/target on the entry bar itself ──
                    # (old code skipped this via `continue`, allowing the entry
                    # bar's wide range to bypass the stop entirely)
                else:
                    continue  # still waiting for entry — skip to next bar

            # ── Trailing stop: ratchet the stop toward the market once in profit ──
            effective_stop = stop
            if params.trail_pct > 0:
                if zone.direction == FVGDirection.BULLISH:
                    trail_extreme = max(trail_extreme, bar.high)
                    trail_level   = trail_extreme * (1 - params.trail_pct / 100)
                    effective_stop = max(stop, trail_level)   # never moves below initial stop
                else:
                    trail_extreme = min(trail_extreme, bar.low)
                    trail_level   = trail_extreme * (1 + params.trail_pct / 100)
                    effective_stop = min(stop, trail_level)   # never moves above initial stop

            # Check exit
            if zone.direction == FVGDirection.BULLISH:
                if bar.low <= effective_stop:
                    _close_trade(trade, effective_stop, bar.time, "stop")
                    break
                elif bar.high >= target:
                    _close_trade(trade, target, bar.time, "target")
                    break
            else:
                if bar.high >= effective_stop:
                    _close_trade(trade, effective_stop, bar.time, "stop")
                    break
                elif bar.low <= target:
                    _close_trade(trade, target, bar.time, "target")
                    break
        else:
            # Zone expired without hitting stop or target
            if triggered and trade and trade.exit_price is None:
                eb = candles[min(entry_bar + params.max_age_bars, len(candles) - 1)]
                expiry_price = eb.close

                # ── FIX 2: never expire at a price worse than the stop ──
                # Prevents "expired" losses larger than the defined risk.
                # (Realistically, the stop would have been hit first.)
                if zone.direction == FVGDirection.BULLISH:
                    expiry_price = max(expiry_price, effective_stop)
                else:
                    expiry_price = min(expiry_price, effective_stop)

                reason = "expired"
                _close_trade(trade, expiry_price, eb.time, reason)

        if trade and trade.pnl is not None:
            capital += trade.pnl
            trades.append(trade)
            equity_curve.append(round(capital, 2))

    return trades, equity_curve


def _close_trade(trade: BacktestTrade, price: float, time: datetime, reason: str):
    trade.exit_price  = price
    trade.exit_time   = time
    trade.exit_reason = reason
    if trade.direction == FVGDirection.BULLISH:
        trade.pnl     = (price - trade.entry) * trade.size
        trade.pnl_pct = (price - trade.entry) / trade.entry * 100
    else:
        trade.pnl     = (trade.entry - price) * trade.size
        trade.pnl_pct = (trade.entry - price) / trade.entry * 100


def compute_stats(trades: list[BacktestTrade]) -> BacktestStats:
    if not trades:
        return BacktestStats(
            total_trades=0, wins=0, losses=0, win_rate=0,
            total_pnl=0, avg_win=0, avg_loss=0, profit_factor=0,
            max_drawdown=0, stops_hit=0, targets_hit=0,
        )

    wins   = [t for t in trades if t.pnl and t.pnl > 0]
    losses = [t for t in trades if t.pnl and t.pnl <= 0]

    total_win  = sum(t.pnl for t in wins)   if wins   else 0.0
    total_loss = sum(t.pnl for t in losses) if losses else 0.0
    profit_factor = abs(total_win / total_loss) if total_loss != 0 else float("inf")

    # Max drawdown on equity curve
    pnls = [t.pnl for t in trades if t.pnl is not None]
    cum  = 0.0
    peak = 0.0
    max_dd = 0.0
    for p in pnls:
        cum  += p
        peak  = max(peak, cum)
        max_dd = min(max_dd, cum - peak)


    return BacktestStats(
        total_trades  = len(trades),
        wins          = len(wins),
        losses        = len(losses),
        win_rate      = round(len(wins) / len(trades) * 100, 1),
        total_pnl     = round(sum(t.pnl for t in trades if t.pnl), 2),
        avg_win       = round(total_win  / len(wins)   if wins   else 0, 2),
        avg_loss      = round(total_loss / len(losses) if losses else 0, 2),
        profit_factor = round(profit_factor, 2),
        max_drawdown  = round(max_dd, 2),
        stops_hit     = len([t for t in trades if t.exit_reason == "stop"]),
        targets_hit   = len([t for t in trades if t.exit_reason == "target"]),
    )


# ── Helpers ───────────────────────────────────────────────────────────────────

def _compute_ema(candles: list[Candle], period: int) -> list[float]:
    if len(candles) < period:
        return []
    closes  = [c.close for c in candles]
    k       = 2 / (period + 1)
    ema     = [sum(closes[:period]) / period]
    for price in closes[period:]:
        ema.append(price * k + ema[-1] * (1 - k))
    # Pad the front so indices align with candle list
    return [0.0] * (period - 1) + ema


def get_fresh_signals(
    candles: list[Candle],
    instrument: str,
    timeframe: str,
    params: StrategyParams,
    lookback_bars: int = 3,
) -> list[FVGZone]:
    """
    Return only FVG zones that formed in the last `lookback_bars` bars.
    Used by the live scanner to identify actionable setups.
    """
    all_zones = detect_fvgs(candles, instrument, timeframe, params)
    latest    = len(candles) - 1
    return [z for z in all_zones if z.bar_index >= latest - lookback_bars]
