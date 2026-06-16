from fastapi import APIRouter, HTTPException, Request
from typing import Optional

from app.models.schemas import (
    AccountSummary, Position, Candle, BacktestRequest, BacktestResult,
    BacktestStats, Signal, OrderRequest, OrderResult, ScannerConfig,
    StrategyParams, FVGZone, INSTRUMENT_CATALOGUE,
)
from app.services.strategy import detect_fvgs, run_backtest, compute_stats
from app.core.config import get_settings

router = APIRouter()


# ── Dependency: get shared service instances from app state ──────────────────

def get_oanda(request: Request):
    return request.app.state.oanda

def get_scanner(request: Request):
    return request.app.state.scanner


# ── Health ────────────────────────────────────────────────────────────────────

@router.get("/health")
async def health():
    return {"status": "ok", "environment": get_settings().oanda_environment}


# ── Instruments ───────────────────────────────────────────────────────────────

@router.get("/instruments")
async def list_instruments():
    """Return all supported instruments with metadata."""
    return {
        "instruments": [
            {"symbol": sym, **meta}
            for sym, meta in INSTRUMENT_CATALOGUE.items()
        ]
    }


# ── Account ───────────────────────────────────────────────────────────────────

@router.get("/account", response_model=AccountSummary)
async def get_account(request: Request):
    oanda = get_oanda(request)
    try:
        return await oanda.get_account()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"OANDA error: {e}")


@router.get("/account/positions", response_model=list[Position])
async def get_positions(request: Request):
    oanda = get_oanda(request)
    try:
        return await oanda.get_positions()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"OANDA error: {e}")


@router.get("/account/orders")
async def get_open_orders(request: Request):
    oanda = get_oanda(request)
    try:
        return await oanda.get_open_orders()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"OANDA error: {e}")


# ── Market data ───────────────────────────────────────────────────────────────

@router.get("/candles/{instrument}", response_model=list[Candle])
async def get_candles(
    request: Request,
    instrument: str,
    granularity: str = "H1",
    count: int = 200,
):
    """Fetch candles for charting. Instrument must be a valid OANDA symbol."""
    if instrument not in INSTRUMENT_CATALOGUE:
        raise HTTPException(status_code=400, detail=f"Unknown instrument: {instrument}")
    oanda = get_oanda(request)
    try:
        return await oanda.get_candles(instrument, granularity, count)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"OANDA error: {e}")


@router.get("/price/{instrument}")
async def get_price(request: Request, instrument: str):
    oanda = get_oanda(request)
    try:
        bid, ask = await oanda.get_current_price(instrument)
        return {"instrument": instrument, "bid": bid, "ask": ask, "mid": (bid + ask) / 2}
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"OANDA error: {e}")


# ── FVG Analysis ──────────────────────────────────────────────────────────────

@router.post("/analyze/{instrument}", response_model=list[FVGZone])
async def analyze_instrument(
    request: Request,
    instrument: str,
    granularity: str = "H1",
    count: int = 300,
    params: StrategyParams = StrategyParams(),
):
    """
    Fetch candles and return all detected FVG zones with OB protection flags.
    Used by the frontend to draw zones on the chart.
    """
    if instrument not in INSTRUMENT_CATALOGUE:
        raise HTTPException(status_code=400, detail=f"Unknown instrument: {instrument}")
    oanda = get_oanda(request)
    try:
        candles = await oanda.get_candles(instrument, granularity, count)
        return detect_fvgs(candles, instrument, granularity, params)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Error: {e}")


# ── Backtest ──────────────────────────────────────────────────────────────────

@router.post("/backtest", response_model=BacktestResult)
async def run_backtest_endpoint(request: Request, body: BacktestRequest):
    """
    Run a full backtest across one or more instruments.
    Fetches historical candles from OANDA and simulates trades.
    """
    oanda = get_oanda(request)
    all_trades = []
    by_instrument = {}

    for instrument in body.instruments:
        if instrument not in INSTRUMENT_CATALOGUE:
            raise HTTPException(status_code=400, detail=f"Unknown instrument: {instrument}")

        try:
            # Convert lookback_days → approximate candle count for the timeframe
            bars_per_day = {
                "M5": 288, "M15": 96, "M30": 48,
                "H1": 24,  "H4": 6,   "D": 1,
            }
            multiplier   = bars_per_day.get(body.timeframe, 24)
            candle_count = min(body.lookback_days * multiplier, 5000)

            candles = await oanda.get_candles(instrument, body.timeframe, candle_count)
            trades, _ = run_backtest(instrument, candles, body.timeframe, body.params)
            all_trades.extend(trades)
            by_instrument[instrument] = compute_stats(trades)

        except Exception as e:
            raise HTTPException(status_code=502, detail=f"{instrument}: {e}")

    # Build equity curve across all instruments in time order
    sorted_trades  = sorted(all_trades, key=lambda t: t.entry_time)
    equity         = [10_000.0]
    for t in sorted_trades:
        equity.append(round(equity[-1] + (t.pnl or 0), 2))

    return BacktestResult(
        request       = body,
        stats         = compute_stats(all_trades),
        trades        = sorted_trades,
        equity_curve  = equity,
        by_instrument = by_instrument,
    )


# ── Orders ────────────────────────────────────────────────────────────────────

@router.post("/orders", response_model=OrderResult)
async def place_order(request: Request, body: OrderRequest):
    """
    Place a bracket order on OANDA based on a signal.
    Calculates position size from account balance and risk %.
    """
    oanda = get_oanda(request)
    try:
        account = await oanda.get_account()
        units   = oanda.calculate_units(
            body.instrument,
            account.balance,
            body.risk_pct,
            body.entry,
            body.stop,
        )
        if units <= 0:
            raise HTTPException(status_code=400, detail="Calculated units is zero — check entry/stop prices")

        return await oanda.place_order(
            instrument  = body.instrument,
            direction   = body.direction,
            units       = units,
            entry_price = body.entry,
            stop_price  = body.stop,
            target_price= body.target,
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Order failed: {e}")


@router.delete("/orders/{order_id}")
async def cancel_order(request: Request, order_id: str):
    oanda = get_oanda(request)
    success = await oanda.cancel_order(order_id)
    if not success:
        raise HTTPException(status_code=400, detail="Could not cancel order")
    return {"cancelled": order_id}


@router.delete("/positions/{instrument}")
async def close_position(request: Request, instrument: str):
    oanda = get_oanda(request)
    success = await oanda.close_position(instrument)
    if not success:
        raise HTTPException(status_code=400, detail="Could not close position")
    return {"closed": instrument}


# ── Scanner ───────────────────────────────────────────────────────────────────

@router.get("/scanner/config", response_model=ScannerConfig)
async def get_scanner_config(request: Request):
    return get_scanner(request).get_config()


@router.put("/scanner/config", response_model=ScannerConfig)
async def update_scanner_config(request: Request, config: ScannerConfig):
    scanner = get_scanner(request)
    scanner.configure(config)
    # If enabled, make sure it's running
    if config.enabled and not scanner.is_running:
        scanner.start()
    elif not config.enabled and scanner.is_running:
        scanner.stop()
    return scanner.get_config()


@router.get("/scanner/signals", response_model=list[Signal])
async def get_signals(request: Request, limit: int = 50):
    return get_scanner(request).get_signals(limit)


@router.delete("/scanner/signals")
async def clear_signals(request: Request):
    get_scanner(request).clear_signals()
    return {"cleared": True}


@router.get("/scanner/status")
async def scanner_status(request: Request):
    scanner = get_scanner(request)
    return {
        "running":     scanner.is_running,
        "config":      scanner.get_config(),
        "signal_count": len(scanner.get_signals(500)),
    }
