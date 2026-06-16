"""
Live scanner — polls OANDA for fresh candles on a schedule
and emits FVG signals.

Signals are stored in memory (for the current session) and
optionally persisted to Supabase.
"""

import asyncio
import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

from apscheduler.schedulers.asyncio import AsyncIOScheduler

from app.models.schemas import Signal, ScannerConfig, StrategyParams, FVGDirection
from app.services.strategy import get_fresh_signals
from app.services.oanda import OandaAdapter

log = logging.getLogger(__name__)


class LiveScanner:
    def __init__(self, oanda: OandaAdapter):
        self._oanda     = oanda
        self._scheduler = AsyncIOScheduler()
        self._config    = ScannerConfig()
        self._signals:  list[Signal] = []
        self._running   = False

    # ── Config ────────────────────────────────────────────────────────────────

    def configure(self, config: ScannerConfig):
        was_running = self._running
        if was_running:
            self.stop()
        self._config = config
        if was_running and config.enabled:
            self.start()

    def get_config(self) -> ScannerConfig:
        return self._config

    # ── Lifecycle ─────────────────────────────────────────────────────────────

    def start(self):
        if self._running:
            return
        interval = self._config.interval_minutes
        self._scheduler.add_job(
            self._scan,
            "interval",
            minutes = interval,
            id      = "fvg_scan",
            replace_existing = True,
            next_run_time    = datetime.now(timezone.utc),  # run immediately on start
        )
        self._scheduler.start()
        self._running = True
        log.info(f"Scanner started — polling every {interval} min for "
                 f"{len(self._config.instruments)} instruments "
                 f"on {self._config.timeframes}")

    def stop(self):
        if not self._running:
            return
        self._scheduler.shutdown(wait=False)
        self._scheduler = AsyncIOScheduler()  # fresh instance for potential restart
        self._running = False
        log.info("Scanner stopped.")

    @property
    def is_running(self) -> bool:
        return self._running

    # ── Signal management ─────────────────────────────────────────────────────

    def get_signals(self, limit: int = 50) -> list[Signal]:
        return sorted(self._signals, key=lambda s: s.timestamp, reverse=True)[:limit]

    def clear_signals(self):
        self._signals.clear()

    # ── Core scan ─────────────────────────────────────────────────────────────

    async def _scan(self):
        if not self._config.enabled:
            return

        log.info(f"Scanner running — {datetime.now(timezone.utc).strftime('%H:%M:%S')} UTC")
        params = self._config.params
        new_signals = 0

        for instrument in self._config.instruments:
            for timeframe in self._config.timeframes:
                try:
                    # Fetch enough candles for EMA + OB lookback + FVG detection
                    candle_count = max(200, params.trend_ema_period + params.ob_lookback + 20)
                    candles = await self._oanda.get_candles(
                        instrument,
                        granularity = timeframe,
                        count       = candle_count,
                    )

                    if len(candles) < 10:
                        log.warning(f"  {instrument} {timeframe}: insufficient candles")
                        continue

                    fresh = get_fresh_signals(candles, instrument, timeframe, params)

                    for zone in fresh:
                        # Calculate trade levels
                        gap_size = zone.top - zone.bottom
                        if zone.direction == FVGDirection.BULLISH:
                            entry  = zone.top  - gap_size * params.entry_pct
                            stop   = zone.bottom - gap_size * params.stop_buffer_pct
                            risk   = entry - stop
                            target = entry + risk * params.rr_ratio
                        else:
                            entry  = zone.bottom + gap_size * params.entry_pct
                            stop   = zone.top    + gap_size * params.stop_buffer_pct
                            risk   = stop - entry
                            target = entry - risk * params.rr_ratio

                        if risk <= 0:
                            continue

                        signal = Signal(
                            id           = str(uuid.uuid4()),
                            instrument   = instrument,
                            direction    = zone.direction,
                            zone_top     = zone.top,
                            zone_bottom  = zone.bottom,
                            entry        = round(entry, 5),
                            stop         = round(stop, 5),
                            target       = round(target, 5),
                            timeframe    = timeframe,
                            timestamp    = zone.timestamp,
                            ob_protected = zone.ob_protected,
                        )
                        self._signals.append(signal)
                        new_signals += 1

                        log.info(
                            f"  SIGNAL: {zone.direction.value.upper()} {instrument} "
                            f"({timeframe}) | entry={entry:.5f} "
                            f"| OB={'YES' if zone.ob_protected else 'no'}"
                        )

                except Exception as e:
                    log.error(f"  Error scanning {instrument} {timeframe}: {e}")

        # Keep signal list from growing unbounded
        if len(self._signals) > 500:
            self._signals = self._signals[-500:]

        if new_signals == 0:
            log.info("  No fresh signals this scan.")
        else:
            log.info(f"  Scan complete — {new_signals} new signal(s).")
