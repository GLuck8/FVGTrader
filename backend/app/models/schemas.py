from pydantic import BaseModel, Field
from typing import Optional, Literal
from datetime import datetime, date
from enum import Enum


# ── Instruments ──────────────────────────────────────────────────────────────

class InstrumentCategory(str, Enum):
    FOREX = "forex"
    INDEX = "index"
    COMMODITY = "commodity"
    CRYPTO = "crypto"

INSTRUMENT_CATALOGUE: dict[str, dict] = {
    # Forex majors
    "EUR_USD": {"name": "EUR/USD",      "category": InstrumentCategory.FOREX,     "pip": 0.0001},
    "GBP_USD": {"name": "GBP/USD",      "category": InstrumentCategory.FOREX,     "pip": 0.0001},
    "USD_JPY": {"name": "USD/JPY",      "category": InstrumentCategory.FOREX,     "pip": 0.01},
    "AUD_USD": {"name": "AUD/USD",      "category": InstrumentCategory.FOREX,     "pip": 0.0001},
    "USD_CAD": {"name": "USD/CAD",      "category": InstrumentCategory.FOREX,     "pip": 0.0001},
    "NZD_USD": {"name": "NZD/USD",      "category": InstrumentCategory.FOREX,     "pip": 0.0001},
    # Indices
    "SPX500_USD": {"name": "S&P 500",   "category": InstrumentCategory.INDEX,     "pip": 0.1},
    "NAS100_USD": {"name": "NASDAQ 100","category": InstrumentCategory.INDEX,     "pip": 0.1},
    "UK100_GBP": {"name": "FTSE 100",   "category": InstrumentCategory.INDEX,     "pip": 0.1},
    "DE30_EUR":  {"name": "DAX 40",     "category": InstrumentCategory.INDEX,     "pip": 0.1},
    "AU200_AUD": {"name": "ASX 200",    "category": InstrumentCategory.INDEX,     "pip": 0.1},
    # Commodities
    "XAU_USD":   {"name": "Gold",       "category": InstrumentCategory.COMMODITY, "pip": 0.01},
    "XAG_USD":   {"name": "Silver",     "category": InstrumentCategory.COMMODITY, "pip": 0.001},
    "WTICO_USD": {"name": "WTI Crude",  "category": InstrumentCategory.COMMODITY, "pip": 0.01},
    "NATGAS_USD":{"name": "Natural Gas","category": InstrumentCategory.COMMODITY, "pip": 0.001},
    # Crypto
    "BTC_USD":   {"name": "Bitcoin",    "category": InstrumentCategory.CRYPTO,    "pip": 1.0},
    "ETH_USD":   {"name": "Ethereum",   "category": InstrumentCategory.CRYPTO,    "pip": 0.1},
}


# ── Candles ───────────────────────────────────────────────────────────────────

class Candle(BaseModel):
    time: datetime
    open: float
    high: float
    low: float
    close: float
    volume: int = 0


# ── Strategy parameters ───────────────────────────────────────────────────────

class StrategyParams(BaseModel):
    # FVG detection
    min_gap_pct: float = Field(0.002, ge=0.0001, le=0.05,
                               description="Minimum gap size as % of price")
    max_age_bars: int  = Field(10,    ge=1,       le=50,
                               description="Max bars to wait for price to enter gap")
    entry_pct: float   = Field(0.5,   ge=0.0,     le=1.0,
                               description="Entry position within gap (0=near edge, 1=far edge)")

    # Order block filter
    ob_filter_enabled: bool = True
    ob_lookback: int   = Field(20, ge=5, le=100,
                               description="Bars to look back for order blocks")
    ob_min_body_pct: float = Field(0.6, ge=0.3, le=1.0,
                                   description="Min candle body/range ratio to qualify as OB")

    # Trend filter
    trend_filter_enabled: bool = True
    trend_ema_period: int = Field(50, ge=10, le=200)

    # Risk management
    rr_ratio: float    = Field(2.0, ge=0.5, le=10.0)
    risk_pct: float    = Field(1.0, ge=0.1, le=5.0,
                               description="% of account to risk per trade")
    stop_buffer_pct: float = Field(0.1, ge=0.0, le=0.5,
                                   description="Extra buffer beyond gap for stop loss (as % of gap size)")

    # Signal separation
    min_bars_between_signals: int = Field(3, ge=1, le=20)


# ── FVG Zone ──────────────────────────────────────────────────────────────────

class FVGDirection(str, Enum):
    BULLISH = "bullish"
    BEARISH = "bearish"

class FVGZone(BaseModel):
    instrument: str
    direction: FVGDirection
    top: float
    bottom: float
    midpoint: float
    gap_pct: float                    # gap size as % of price
    bar_index: int
    timestamp: datetime
    timeframe: str
    ob_protected: bool = False        # True if backed by a qualifying order block
    ob_price: Optional[float] = None  # Price level of the protecting OB


# ── Order Block ───────────────────────────────────────────────────────────────

class OrderBlock(BaseModel):
    direction: FVGDirection           # bullish OB = demand zone, bearish = supply
    top: float
    bottom: float
    bar_index: int
    timestamp: datetime
    strength: float                   # body % of range, higher = stronger


# ── Backtest ──────────────────────────────────────────────────────────────────

class BacktestRequest(BaseModel):
    instruments: list[str]
    timeframe: str = "H1"
    lookback_days: int = Field(90, ge=7, le=365)
    params: StrategyParams = StrategyParams()


class BacktestTrade(BaseModel):
    instrument: str
    direction: FVGDirection
    entry: float
    stop: float
    target: float
    size: float
    entry_time: datetime
    exit_time: Optional[datetime] = None
    exit_price: Optional[float] = None
    exit_reason: Optional[Literal["target", "stop", "expired"]] = None
    pnl: Optional[float] = None
    pnl_pct: Optional[float] = None
    ob_protected: bool = False


class BacktestStats(BaseModel):
    total_trades: int
    wins: int
    losses: int
    win_rate: float
    total_pnl: float
    avg_win: float
    avg_loss: float
    profit_factor: float
    max_drawdown: float
    stops_hit: int
    targets_hit: int


class BacktestResult(BaseModel):
    request: BacktestRequest
    stats: BacktestStats
    trades: list[BacktestTrade]
    equity_curve: list[float]         # running P&L for chart
    by_instrument: dict[str, BacktestStats]


# ── Live signals & orders ─────────────────────────────────────────────────────

class Signal(BaseModel):
    id: str
    instrument: str
    direction: FVGDirection
    zone_top: float
    zone_bottom: float
    entry: float
    stop: float
    target: float
    timeframe: str
    timestamp: datetime
    ob_protected: bool = False
    status: Literal["pending", "triggered", "expired", "cancelled"] = "pending"


class OrderRequest(BaseModel):
    signal_id: str
    instrument: str
    direction: FVGDirection
    entry: float
    stop: float
    target: float
    risk_pct: float = 1.0


class OrderResult(BaseModel):
    order_id: str
    instrument: str
    direction: FVGDirection
    units: float
    entry: float
    stop: float
    target: float
    status: str
    timestamp: datetime


# ── Scanner config ────────────────────────────────────────────────────────────

class ScannerConfig(BaseModel):
    enabled: bool = False
    instruments: list[str] = ["EUR_USD", "XAU_USD", "SPX500_USD"]
    timeframes: list[str] = ["H1", "H4"]
    interval_minutes: int = Field(15, ge=1, le=60)
    params: StrategyParams = StrategyParams()


# ── Account ───────────────────────────────────────────────────────────────────

class AccountSummary(BaseModel):
    account_id: str
    currency: str
    balance: float
    nav: float                        # net asset value
    unrealized_pnl: float
    open_trade_count: int
    environment: str                  # "practice" | "live"


class Position(BaseModel):
    instrument: str
    direction: FVGDirection
    units: float
    avg_price: float
    current_price: float
    unrealized_pnl: float
    open_time: Optional[datetime] = None


# ── ORB-FVG Strategy ──────────────────────────────────────────────────────────

class ORBParams(BaseModel):
    min_body_pct: float = Field(0.6, ge=0.3, le=1.0,
                                description="Breakout candle body must be >= this fraction of its range")
    rr_ratio: float = Field(3.0, ge=1.0, le=10.0,
                            description="Risk:Reward ratio for target")
    stop_buffer_pct: float = Field(0.2, ge=0.0, le=1.0,
                                   description="Extra buffer below/above retest candles as % of FVG size")
    max_wait_bars: int = Field(60, ge=10, le=240,
                               description="Max M1 bars to wait for retest after FVG forms")
    risk_pct: float = Field(1.0, ge=0.1, le=5.0,
                            description="% of account balance to risk per trade")


class ORBStatus(str, Enum):
    WAITING_FOR_OPEN     = "waiting_for_open"
    BUILDING_RANGE       = "building_range"
    WAITING_FOR_BREAKOUT = "waiting_for_breakout"
    FVG_FORMED           = "fvg_formed"
    ENTRY_SIGNAL         = "entry_signal"
    EXPIRED              = "expired"
    NO_SETUP             = "no_setup"


class ORBEntrySignal(BaseModel):
    entry: float
    stop: float
    target: float
    entry_time: datetime
    risk: float
    reward: float


class ORBDailySetup(BaseModel):
    instrument: str
    date: str
    status: ORBStatus

    opening_range_high: Optional[float]  = None
    opening_range_low: Optional[float]   = None
    range_size: Optional[float]          = None

    direction: Optional[FVGDirection]    = None
    breakout_price: Optional[float]      = None
    breakout_time: Optional[datetime]    = None
    breakout_body_pct: Optional[float]   = None

    fvg_top: Optional[float]             = None
    fvg_bottom: Optional[float]          = None
    fvg_midpoint: Optional[float]        = None

    signal: Optional[ORBEntrySignal]     = None


class ORBBacktestRequest(BaseModel):
    instruments: list[str]
    lookback_days: int = Field(15, ge=1, le=60,
                               description="Trading days to analyse (bounded by OANDA 5000-bar limit)")
    params: ORBParams = ORBParams()


class ORBBacktestResult(BaseModel):
    request: ORBBacktestRequest
    stats: BacktestStats
    trades: list[BacktestTrade]
    equity_curve: list[float]
    by_instrument: dict[str, BacktestStats]
    daily_setups: list[ORBDailySetup]           # one per trading day processed
