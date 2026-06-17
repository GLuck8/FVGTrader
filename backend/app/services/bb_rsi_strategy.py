"""
Bollinger Band + RSI mean-reversion strategy.

Setup:
  - Price touches or closes outside a Bollinger Band (default 20-period, 2 std)
  - RSI confirms oversold (<30) for longs, overbought (>70) for shorts
  - Entry candle closes back inside the band ("snap-back" confirmation)
  - Stop: outer band (or recent swing extreme), Target: middle band (SMA)
  - Optional: require price to be on the correct side of a trend EMA

Pure functions — no I/O, no side effects.
"""

import logging
import math
from datetime import datetime
from typing import Optional

from app.models.schemas import (
    Candle, FVGDirection, BacktestTrade, BacktestStats,
)
from app.services.strategy import _close_trade, compute_stats

log = logging.getLogger(__name__)


# ── Indicators ────────────────────────────────────────────────────────────────

def _compute_sma(closes: list[float], period: int) -> list[float]:
    """Simple moving average, padded with 0.0 for the warm-up bars."""
    out = [0.0] * (period - 1)
    for i in range(period - 1, len(closes)):
        out.append(sum(closes[i - period + 1 : i + 1]) / period)
    return out


def _compute_bollinger(
    closes: list[float], period: int = 20, num_std: float = 2.0
) -> tuple[list[float], list[float], list[float]]:
    """
    Returns (upper, mid, lower) bands aligned with closes list.
    First (period-1) values are all 0.0.
    """
    mid   = _compute_sma(closes, period)
    upper = [0.0] * len(closes)
    lower = [0.0] * len(closes)
    for i in range(period - 1, len(closes)):
        window = closes[i - period + 1 : i + 1]
        std    = math.sqrt(sum((x - mid[i]) ** 2 for x in window) / period)
        upper[i] = mid[i] + num_std * std
        lower[i] = mid[i] - num_std * std
    return upper, mid, lower


def _compute_rsi(closes: list[float], period: int = 14) -> list[float]:
    """
    Wilder RSI, aligned with closes. First (period) values are 0.0.
    """
    rsi = [0.0] * len(closes)
    if len(closes) < period + 1:
        return rsi

    # Seed with simple average
    gains, losses = [], []
    for i in range(1, period + 1):
        d = closes[i] - closes[i - 1]
        gains.append(max(d, 0.0))
        losses.append(max(-d, 0.0))

    avg_gain = sum(gains) / period
    avg_loss = sum(losses) / period

    for i in range(period, len(closes)):
        if i > period:
            d        = closes[i] - closes[i - 1]
            avg_gain = (avg_gain * (period - 1) + max(d, 0.0))  / period
            avg_loss = (avg_loss * (period - 1) + max(-d, 0.0)) / period
        if avg_loss == 0:
            rsi[i] = 100.0
        else:
            rs     = avg_gain / avg_loss
            rsi[i] = 100 - (100 / (1 + rs))

    return rsi


def _compute_ema(closes: list[float], period: int) -> list[float]:
    if len(closes) < period:
        return [0.0] * len(closes)
    k   = 2 / (period + 1)
    ema = [0.0] * (period - 1)
    ema.append(sum(closes[:period]) / period)
    for price in closes[period:]:
        ema.append(price * k + ema[-1] * (1 - k))
    return ema


# ── Signal Detection ──────────────────────────────────────────────────────────

def detect_bb_rsi_signals(
    candles: list[Candle],
    instrument: str,
    timeframe: str,
    params: "BBRSIParams",
) -> list["BBRSISignal"]:
    """
    Scan candles for BB+RSI snap-back setups.
    Returns a list of BBRSISignal objects (entry, stop, target, direction, bar_index).
    """
    from app.models.schemas import BBRSIParams, BBRSISignal

    if len(candles) < max(params.bb_period, params.rsi_period) + 5:
        return []

    closes = [c.close for c in candles]
    upper, mid, lower = _compute_bollinger(closes, params.bb_period, params.bb_std)
    rsi               = _compute_rsi(closes, params.rsi_period)
    ema               = _compute_ema(closes, params.trend_ema_period) if params.trend_filter_enabled else []

    signals: list[BBRSISignal] = []
    warmup = max(params.bb_period, params.rsi_period, params.trend_ema_period) + 1

    for i in range(warmup, len(candles)):
        bar  = candles[i]
        prev = candles[i - 1]

        if upper[i] == 0.0 or lower[i] == 0.0:
            continue

        band_width = upper[i] - lower[i]
        if band_width <= 0:
            continue

        # ── Bullish setup: previous bar closed below lower band + RSI oversold ──
        if (prev.close < lower[i - 1] and
                rsi[i - 1] < params.rsi_oversold and
                bar.close > lower[i]):           # snap-back: closes back inside

            # Trend filter: price must be above trend EMA
            if params.trend_filter_enabled and ema and bar.close < ema[i]:
                continue

            entry  = bar.close
            stop   = bar.low - band_width * params.stop_buffer_pct
            risk   = entry - stop
            if risk <= 0:
                continue
            target = mid[i]                      # mean-reversion to SMA
            if target <= entry:
                continue

            signals.append(BBRSISignal(
                instrument = instrument,
                direction  = FVGDirection.BULLISH,
                entry      = round(entry, 6),
                stop       = round(stop,  6),
                target     = round(target, 6),
                band_top   = round(upper[i], 6),
                band_mid   = round(mid[i],   6),
                band_bot   = round(lower[i], 6),
                rsi_value  = round(rsi[i - 1], 2),
                bar_index  = i,
                timestamp  = bar.time,
                timeframe  = timeframe,
            ))

        # ── Bearish setup: previous bar closed above upper band + RSI overbought ──
        elif (prev.close > upper[i - 1] and
                rsi[i - 1] > params.rsi_overbought and
                bar.close < upper[i]):           # snap-back: closes back inside

            # Trend filter: price must be below trend EMA
            if params.trend_filter_enabled and ema and bar.close > ema[i]:
                continue

            entry  = bar.close
            stop   = bar.high + band_width * params.stop_buffer_pct
            risk   = stop - entry
            if risk <= 0:
                continue
            target = mid[i]
            if target >= entry:
                continue

            signals.append(BBRSISignal(
                instrument = instrument,
                direction  = FVGDirection.BEARISH,
                entry      = round(entry, 6),
                stop       = round(stop,  6),
                target     = round(target, 6),
                band_top   = round(upper[i], 6),
                band_mid   = round(mid[i],   6),
                band_bot   = round(lower[i], 6),
                rsi_value  = round(rsi[i - 1], 2),
                bar_index  = i,
                timestamp  = bar.time,
                timeframe  = timeframe,
            ))

    return signals


# ── Backtester ────────────────────────────────────────────────────────────────

def run_bb_rsi_backtest(
    instrument: str,
    candles: list[Candle],
    timeframe: str,
    params: "BBRSIParams",
    starting_capital: float = 10_000.0,
) -> tuple[list[BacktestTrade], list[float]]:
    """
    Simulate BB+RSI entries. Returns (trades, equity_curve).
    Entry is at-close of the signal bar (market order on close).
    Stop and target are OCO orders placed immediately.
    """
    signals = detect_bb_rsi_signals(candles, instrument, timeframe, params)

    trades: list[BacktestTrade]  = []
    equity_curve: list[float]    = [starting_capital]
    capital  = starting_capital
    last_bar = -999

    for sig in signals:
        i = sig.bar_index

        # Minimum bar separation between signals
        if i - last_bar < params.min_bars_between_signals:
            continue

        risk         = abs(sig.entry - sig.stop)
        risk_dollars = capital * (params.risk_pct / 100)
        size         = round(risk_dollars / risk, 4)

        trade = BacktestTrade(
            instrument   = instrument,
            direction    = sig.direction,
            entry        = sig.entry,
            stop         = sig.stop,
            target       = sig.target,
            size         = size,
            entry_time   = sig.timestamp,
            ob_protected = False,
        )
        last_bar     = i
        trail_extreme = sig.entry

        exited = False
        for j in range(i + 1, min(i + params.max_age_bars + 1, len(candles))):
            bar = candles[j]

            # Trailing stop
            effective_stop = sig.stop
            if params.trail_pct > 0:
                if sig.direction == FVGDirection.BULLISH:
                    trail_extreme  = max(trail_extreme, bar.high)
                    trail_level    = trail_extreme * (1 - params.trail_pct / 100)
                    effective_stop = max(sig.stop, trail_level)
                else:
                    trail_extreme  = min(trail_extreme, bar.low)
                    trail_level    = trail_extreme * (1 + params.trail_pct / 100)
                    effective_stop = min(sig.stop, trail_level)

            if sig.direction == FVGDirection.BULLISH:
                if bar.low <= effective_stop:
                    _close_trade(trade, effective_stop, bar.time, "stop")
                    exited = True; break
                elif bar.high >= sig.target:
                    _close_trade(trade, sig.target, bar.time, "target")
                    exited = True; break
            else:
                if bar.high >= effective_stop:
                    _close_trade(trade, effective_stop, bar.time, "stop")
                    exited = True; break
                elif bar.low <= sig.target:
                    _close_trade(trade, sig.target, bar.time, "target")
                    exited = True; break

        if not exited and trade.exit_price is None:
            eb            = candles[min(i + params.max_age_bars, len(candles) - 1)]
            expiry_price  = eb.close
            # Cap expiry at stop — never worse than defined risk
            if sig.direction == FVGDirection.BULLISH:
                expiry_price = max(expiry_price, effective_stop)
            else:
                expiry_price = min(expiry_price, effective_stop)
            _close_trade(trade, expiry_price, eb.time, "expired")

        if trade.pnl is not None:
            capital += trade.pnl
            trades.append(trade)
            equity_curve.append(round(capital, 2))

    return trades, equity_curve
