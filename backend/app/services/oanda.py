"""
OANDA v20 REST API adapter.

All interaction with OANDA goes through this class.
If you ever add a second broker, create a new adapter that
implements the same public methods and swap it in via dependency injection.
"""

import httpx
import logging
from datetime import datetime, timezone
from typing import Optional

from app.core.config import get_settings
from app.models.schemas import (
    Candle, AccountSummary, Position, OrderResult,
    FVGDirection, INSTRUMENT_CATALOGUE
)

log = logging.getLogger(__name__)

# OANDA granularity strings → readable labels
TIMEFRAME_MAP = {
    "M5":  "5 min",
    "M15": "15 min",
    "M30": "30 min",
    "H1":  "1 hour",
    "H4":  "4 hour",
    "D":   "Daily",
    "W":   "Weekly",
}


class OandaAdapter:
    """
    Thin async wrapper around the OANDA v20 REST API.

    Instantiate once and reuse — httpx.AsyncClient is kept open
    for the life of the app to benefit from connection pooling.
    """

    def __init__(self):
        settings = get_settings()
        self._account_id = settings.oanda_account_id
        self._base_url   = settings.oanda_base_url
        self._headers = {
            "Authorization": f"Bearer {settings.oanda_api_key}",
            "Content-Type":  "application/json",
            "Accept-Datetime-Format": "RFC3339",
        }
        self._client: Optional[httpx.AsyncClient] = None

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                base_url=self._base_url,
                headers=self._headers,
                timeout=30.0,
            )
        return self._client

    async def close(self):
        if self._client and not self._client.is_closed:
            await self._client.aclose()

    # ── Account ───────────────────────────────────────────────────────────────

    async def get_account(self) -> AccountSummary:
        client = await self._get_client()
        r = await client.get(f"/v3/accounts/{self._account_id}/summary")
        r.raise_for_status()
        a = r.json()["account"]
        return AccountSummary(
            account_id      = a["id"],
            currency        = a["currency"],
            balance         = float(a["balance"]),
            nav             = float(a["NAV"]),
            unrealized_pnl  = float(a["unrealizedPL"]),
            open_trade_count= int(a["openTradeCount"]),
            environment     = get_settings().oanda_environment,
        )

    async def get_positions(self) -> list[Position]:
        client = await self._get_client()
        r = await client.get(f"/v3/accounts/{self._account_id}/openPositions")
        r.raise_for_status()
        positions = []
        for p in r.json().get("positions", []):
            long_units  = float(p["long"]["units"])
            short_units = float(p["short"]["units"])
            if long_units > 0:
                direction = FVGDirection.BULLISH
                units     = long_units
                avg_price = float(p["long"]["averagePrice"])
                upnl      = float(p["long"]["unrealizedPL"])
            else:
                direction = FVGDirection.BEARISH
                units     = abs(short_units)
                avg_price = float(p["short"]["averagePrice"])
                upnl      = float(p["short"]["unrealizedPL"])

            positions.append(Position(
                instrument     = p["instrument"],
                direction      = direction,
                units          = units,
                avg_price      = avg_price,
                current_price  = 0.0,  # enriched separately if needed
                unrealized_pnl = upnl,
            ))
        return positions

    # ── Market data ───────────────────────────────────────────────────────────

    async def get_candles(
        self,
        instrument: str,
        granularity: str = "H1",
        count: int = 500,
    ) -> list[Candle]:
        """
        Fetch up to `count` historical candles for an instrument.
        granularity: M5, M15, M30, H1, H4, D, W
        """
        client = await self._get_client()
        r = await client.get(
            f"/v3/instruments/{instrument}/candles",
            params={
                "granularity": granularity,
                "count":       min(count, 5000),
                "price":       "M",   # midpoint prices
            },
        )
        r.raise_for_status()
        candles = []
        for c in r.json().get("candles", []):
            if not c.get("complete", True):
                continue  # skip the forming bar
            mid = c["mid"]
            candles.append(Candle(
                time   = datetime.fromisoformat(c["time"].replace("Z", "+00:00")),
                open   = float(mid["o"]),
                high   = float(mid["h"]),
                low    = float(mid["l"]),
                close  = float(mid["c"]),
                volume = int(c.get("volume", 0)),
            ))
        return candles

    async def get_current_price(self, instrument: str) -> tuple[float, float]:
        """Returns (bid, ask) for an instrument."""
        client = await self._get_client()
        r = await client.get(
            f"/v3/accounts/{self._account_id}/pricing",
            params={"instruments": instrument},
        )
        r.raise_for_status()
        prices = r.json()["prices"][0]
        return float(prices["bids"][0]["price"]), float(prices["asks"][0]["price"])

    # ── Order execution ───────────────────────────────────────────────────────

    async def place_order(
        self,
        instrument: str,
        direction: FVGDirection,
        units: float,
        entry_price: float,
        stop_price: float,
        target_price: float,
    ) -> OrderResult:
        """
        Places a limit order with attached stop-loss and take-profit (bracket order).
        units: positive for buy, will be negated automatically for sells.
        """
        client = await self._get_client()
        signed_units = units if direction == FVGDirection.BULLISH else -units

        payload = {
            "order": {
                "type":        "LIMIT",
                "instrument":  instrument,
                "units":       str(round(signed_units, 2)),
                "price":       str(round(entry_price, 5)),
                "timeInForce": "GTC",
                "stopLossOnFill": {
                    "price": str(round(stop_price, 5)),
                    "timeInForce": "GTC",
                },
                "takeProfitOnFill": {
                    "price": str(round(target_price, 5)),
                    "timeInForce": "GTC",
                },
            }
        }

        r = await client.post(
            f"/v3/accounts/{self._account_id}/orders",
            json=payload,
        )
        r.raise_for_status()
        data = r.json()
        created = data.get("orderCreateTransaction", {})

        log.info(
            f"Order placed: {direction.value} {instrument} "
            f"entry={entry_price} stop={stop_price} target={target_price} "
            f"units={signed_units}"
        )

        return OrderResult(
            order_id   = created.get("orderID", created.get("id", "unknown")),
            instrument = instrument,
            direction  = direction,
            units      = signed_units,
            entry      = entry_price,
            stop       = stop_price,
            target     = target_price,
            status     = "created",
            timestamp  = datetime.now(timezone.utc),
        )

    async def cancel_order(self, order_id: str) -> bool:
        client = await self._get_client()
        r = await client.put(
            f"/v3/accounts/{self._account_id}/orders/{order_id}/cancel"
        )
        return r.status_code == 200

    async def close_position(self, instrument: str) -> bool:
        """Close all units of an open position."""
        client = await self._get_client()
        r = await client.put(
            f"/v3/accounts/{self._account_id}/positions/{instrument}/close",
            json={"longUnits": "ALL", "shortUnits": "ALL"},
        )
        return r.status_code == 200

    # ── Utility ───────────────────────────────────────────────────────────────

    async def get_open_orders(self) -> list[dict]:
        client = await self._get_client()
        r = await client.get(f"/v3/accounts/{self._account_id}/orders")
        r.raise_for_status()
        return r.json().get("orders", [])

    def calculate_units(
        self,
        instrument: str,
        account_balance: float,
        risk_pct: float,
        entry: float,
        stop: float,
    ) -> float:
        """
        Calculate position size in units based on account risk %.
        For forex: 1 unit = 1 base currency unit.
        For indices/commodities: units represent CFD contracts.
        """
        risk_amount = account_balance * (risk_pct / 100)
        price_risk  = abs(entry - stop)
        if price_risk == 0:
            return 0.0

        pip_info = INSTRUMENT_CATALOGUE.get(instrument, {})
        pip_size = pip_info.get("pip", 0.0001)

        # For forex, risk per unit = pip risk / pip size * pip value
        # Simplified: risk_amount / price_risk gives units directly
        # This is accurate for USD-denominated instruments;
        # for cross pairs it's an approximation (good enough for sizing)
        units = risk_amount / price_risk
        return round(units, 2)
