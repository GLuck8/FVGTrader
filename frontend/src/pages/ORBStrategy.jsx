/**
 * ORB-FVG Strategy page
 *
 * Left panel  — Today's Setup (live ORB analysis for the current session)
 * Right panel — Backtest (historical M1 simulation, ~12 trading days)
 */

import { useState, useEffect, useCallback } from 'react'
import { getORBAnalysis, runORBBacktest } from '../api/client'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts'
import clsx from 'clsx'

// ──────────────────────────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────────────────────────

const ORB_INSTRUMENTS = [
  { symbol: 'SPX500_USD', name: 'S&P 500' },
  { symbol: 'NAS100_USD', name: 'NASDAQ 100' },
]

const STATUS_META = {
  waiting_for_open:     { label: 'Waiting for open',       color: 'text-gray-400',  dot: 'bg-gray-500' },
  building_range:       { label: 'Building opening range', color: 'text-brand',     dot: 'bg-brand animate-pulse' },
  waiting_for_breakout: { label: 'Waiting for breakout',   color: 'text-yellow-400',dot: 'bg-yellow-400' },
  fvg_formed:           { label: 'FVG formed – awaiting retest', color: 'text-bull', dot: 'bg-bull animate-pulse' },
  entry_signal:         { label: 'Entry signal ready',     color: 'text-bull',      dot: 'bg-bull' },
  expired:              { label: 'No setup today',         color: 'text-gray-500',  dot: 'bg-gray-600' },
  no_setup:             { label: 'No setup detected',      color: 'text-gray-500',  dot: 'bg-gray-600' },
}

const DEFAULT_PARAMS = {
  min_body_pct: 0.6,
  rr_ratio: 3.0,
  stop_buffer_pct: 0.2,
  max_wait_bars: 60,
  risk_pct: 1.0,
}

// ──────────────────────────────────────────────────────────────────────────────
// Page
// ──────────────────────────────────────────────────────────────────────────────

export default function ORBStrategy() {
  const [activeTab, setActiveTab] = useState('live')

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">ORB-FVG Strategy</h1>
          <p className="text-xs text-gray-500 mt-0.5">
            Opening Range Breakout · 9:30 AM ET · US indices only
          </p>
        </div>
        <div className="flex rounded-lg overflow-hidden border border-surface-border">
          {['live', 'backtest'].map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={clsx(
                'px-4 py-1.5 text-sm font-medium capitalize transition-colors',
                activeTab === tab
                  ? 'bg-brand text-white'
                  : 'text-gray-400 hover:bg-surface-hover'
              )}
            >
              {tab === 'live' ? "Today's Setup" : 'Backtest'}
            </button>
          ))}
        </div>
      </div>

      {activeTab === 'live' ? <LiveTab /> : <BacktestTab />}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────────
// Live tab
// ──────────────────────────────────────────────────────────────────────────────

function LiveTab() {
  const [instrument, setInstrument] = useState('SPX500_USD')
  const [setup, setSetup]           = useState(null)
  const [loading, setLoading]       = useState(false)
  const [error, setError]           = useState(null)
  const [params, setParams]         = useState(DEFAULT_PARAMS)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await getORBAnalysis(instrument)
      setSetup(data)
    } catch (err) {
      setError(err?.response?.data?.detail || 'Failed to fetch ORB setup')
    } finally {
      setLoading(false)
    }
  }, [instrument])

  // Auto-refresh every 60 seconds during market hours
  useEffect(() => {
    refresh()
    const t = setInterval(refresh, 60_000)
    return () => clearInterval(t)
  }, [refresh])

  const meta   = setup ? (STATUS_META[setup.status] || STATUS_META.no_setup) : null
  const hasORB = setup?.opening_range_high != null
  const hasFVG = setup?.fvg_top != null
  const hasSig = setup?.signal != null

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

      {/* ── Controls ─────────────────────────────── */}
      <div className="card space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-200">Live Setup</h2>
          <button
            onClick={refresh}
            disabled={loading}
            className="btn-ghost text-sm"
          >
            {loading ? '…' : '↻ Refresh'}
          </button>
        </div>

        {/* Instrument picker */}
        <div className="flex gap-2">
          {ORB_INSTRUMENTS.map(inst => (
            <button
              key={inst.symbol}
              onClick={() => setInstrument(inst.symbol)}
              className={clsx(
                'flex-1 py-2 text-sm rounded-lg border transition-colors font-medium',
                instrument === inst.symbol
                  ? 'bg-brand/20 border-brand text-brand'
                  : 'border-surface-border text-gray-400 hover:border-gray-500'
              )}
            >
              {inst.name}
            </button>
          ))}
        </div>

        {error && <p className="text-bear text-xs">{error}</p>}

        {/* Status indicator */}
        {setup && meta && (
          <div className="flex items-center gap-2">
            <span className={clsx('w-2 h-2 rounded-full', meta.dot)} />
            <span className={clsx('text-sm font-medium', meta.color)}>
              {meta.label}
            </span>
          </div>
        )}

        {/* ORB levels */}
        {hasORB && (
          <div className="space-y-2 pt-2 border-t border-surface-border">
            <p className="text-xs text-gray-500 font-medium uppercase tracking-wider">
              Opening Range ({setup.date})
            </p>
            <div className="grid grid-cols-3 gap-2">
              <LevelCard label="High" value={setup.opening_range_high?.toFixed(2)} color="text-bull" />
              <LevelCard label="Low"  value={setup.opening_range_low?.toFixed(2)}  color="text-bear" />
              <LevelCard label="Size" value={setup.range_size?.toFixed(2)}         color="text-gray-300" />
            </div>
          </div>
        )}

        {/* Breakout info */}
        {setup?.direction && (
          <div className="space-y-2 pt-2 border-t border-surface-border">
            <div className="flex items-center gap-2">
              <p className="text-xs text-gray-500 font-medium uppercase tracking-wider">Breakout</p>
              <span className={setup.direction === 'bullish' ? 'badge-bull' : 'badge-bear'}>
                {setup.direction === 'bullish' ? '▲ Bullish' : '▼ Bearish'}
              </span>
            </div>
            <div className="flex gap-2 text-xs text-gray-400">
              <span>Price: <span className="text-gray-200 font-mono">{setup.breakout_price?.toFixed(2)}</span></span>
              <span>·</span>
              <span>Body: <span className="text-gray-200 font-mono">{setup.breakout_body_pct != null ? `${(setup.breakout_body_pct * 100).toFixed(0)}%` : '—'}</span></span>
            </div>
          </div>
        )}

        {/* FVG levels */}
        {hasFVG && (
          <div className="space-y-2 pt-2 border-t border-surface-border">
            <p className="text-xs text-gray-500 font-medium uppercase tracking-wider">FVG Zone</p>
            <div className="grid grid-cols-3 gap-2">
              <LevelCard label="Top"      value={setup.fvg_top?.toFixed(2)}      color="text-bull" />
              <LevelCard label="Mid"      value={setup.fvg_midpoint?.toFixed(2)} color="text-gray-300" />
              <LevelCard label="Bottom"   value={setup.fvg_bottom?.toFixed(2)}   color="text-bear" />
            </div>
          </div>
        )}
      </div>

      {/* ── Signal card ───────────────────────────── */}
      <div className="card space-y-4">
        <h2 className="text-sm font-semibold text-gray-200">Entry Signal</h2>

        {!hasSig ? (
          <div className="flex items-center justify-center h-40 text-gray-600 text-sm">
            {setup?.status === 'no_setup' || setup?.status === 'expired'
              ? 'No valid setup today'
              : 'Waiting for retest + engulfing…'}
          </div>
        ) : (
          <div className="space-y-4">
            <div className={clsx(
              'rounded-lg px-4 py-3 border',
              setup.direction === 'bullish'
                ? 'bg-bull/10 border-bull/30'
                : 'bg-bear/10 border-bear/30'
            )}>
              <p className={clsx(
                'text-sm font-semibold',
                setup.direction === 'bullish' ? 'text-bull' : 'text-bear'
              )}>
                {setup.direction === 'bullish' ? '▲ BUY' : '▼ SELL'} {instrument.replace('_', '/')}
              </p>
              <p className="text-xs text-gray-400 mt-0.5">
                Entry at close of engulfing candle • {new Date(setup.signal.entry_time).toLocaleTimeString()}
              </p>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <LevelCard label="Entry"  value={setup.signal.entry?.toFixed(2)}  color="text-gray-200" />
              <LevelCard label="Stop"   value={setup.signal.stop?.toFixed(2)}   color="text-bear" />
              <LevelCard label="Target" value={setup.signal.target?.toFixed(2)} color="text-bull" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <LevelCard label="Risk"   value={setup.signal.risk?.toFixed(2)}   color="text-bear" />
              <LevelCard label="Reward" value={setup.signal.reward?.toFixed(2)} color="text-bull" />
            </div>

            <p className="text-xs text-gray-600 mt-2">
              ⚠ Review the setup on the Chart page before placing any order.
              Always confirm context and risk manually.
            </p>
          </div>
        )}
      </div>

      {/* ── Strategy explanation ─────────────────── */}
      <div className="card lg:col-span-2 space-y-3">
        <h2 className="text-sm font-semibold text-gray-200">How it works</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs text-gray-400">
          <Step n={1} title="Opening Range">
            At 9:30 AM ET the first 5 M1 candles define the range. High and low become
            the breakout levels.
          </Step>
          <Step n={2} title="Breakout + FVG">
            The first large-body candle to close beyond the range is the centre of an FVG.
            The previous candle's wick and following candle's wick form the gap bounds.
          </Step>
          <Step n={3} title="Retest Entry">
            Wait for price to return to the FVG zone, then enter on an engulfing candle
            in the trend direction. Stop = below retest lows. Target = 3:1 R:R.
          </Step>
        </div>
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────────
// Backtest tab
// ──────────────────────────────────────────────────────────────────────────────

function BacktestTab() {
  const [selected,     setSelected]     = useState(['SPX500_USD'])
  const [lookbackDays, setLookbackDays] = useState(15)
  const [params,       setParams]       = useState(DEFAULT_PARAMS)
  const [result,       setResult]       = useState(null)
  const [running,      setRunning]      = useState(false)
  const [error,        setError]        = useState(null)

  const setParam = (k, v) => setParams(p => ({ ...p, [k]: v }))

  const toggleInst = (sym) =>
    setSelected(s => s.includes(sym) ? s.filter(x => x !== sym) : [...s, sym])

  const handleRun = async () => {
    if (!selected.length) return
    setRunning(true)
    setError(null)
    try {
      const data = await runORBBacktest({
        instruments: selected,
        lookback_days: lookbackDays,
        params,
      })
      setResult(data)
    } catch (err) {
      setError(err?.response?.data?.detail || 'Backtest failed')
    } finally {
      setRunning(false)
    }
  }

  const equityData = result?.equity_curve.map((v, i) => ({ i, v })) ?? []

  return (
    <div className="space-y-6">
      {/* ── Config ──────────────────────────────── */}
      <div className="card space-y-4">
        <h2 className="text-sm font-semibold text-gray-200">Backtest Parameters</h2>

        {/* Instruments */}
        <div>
          <label className="text-xs text-gray-400 mb-2 block">Instruments</label>
          <div className="flex gap-2">
            {ORB_INSTRUMENTS.map(inst => (
              <button
                key={inst.symbol}
                onClick={() => toggleInst(inst.symbol)}
                className={clsx(
                  'px-3 py-1.5 rounded text-xs font-mono border transition-colors',
                  selected.includes(inst.symbol)
                    ? 'bg-brand/20 border-brand text-brand'
                    : 'border-surface-border text-gray-500 hover:border-gray-500'
                )}
              >
                {inst.name}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <SliderParam
            label="Lookback"
            value={lookbackDays}
            displayValue={`${lookbackDays} days`}
            min={3} max={60} step={1}
            onChange={v => setLookbackDays(v)}
            hint="Capped at ~12 trading days by OANDA's M1 data limit"
          />
          <SliderParam
            label="Min Body %"
            value={+(params.min_body_pct * 100)}
            displayValue={`${+(params.min_body_pct * 100)}%`}
            min={30} max={100} step={5}
            onChange={v => setParam('min_body_pct', v / 100)}
          />
          <SliderParam
            label="R:R Ratio"
            value={params.rr_ratio}
            displayValue={`${params.rr_ratio}:1`}
            min={1} max={5} step={0.5}
            onChange={v => setParam('rr_ratio', v)}
          />
          <SliderParam
            label="Max Wait"
            value={params.max_wait_bars}
            displayValue={`${params.max_wait_bars} bars`}
            min={15} max={180} step={15}
            onChange={v => setParam('max_wait_bars', v)}
            hint="M1 bars to wait for retest (60 = 1 hour)"
          />
        </div>

        {error && <p className="text-bear text-xs">{error}</p>}

        <button
          onClick={handleRun}
          disabled={running || !selected.length}
          className="btn-primary w-full"
        >
          {running ? 'Running backtest…' : 'Run ORB Backtest'}
        </button>
      </div>

      {result && (
        <>
          {/* ── Stats grid ───────────────────────── */}
          <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-3">
            <StatCard label="Trades"        value={result.stats.total_trades} />
            <StatCard label="Win Rate"      value={`${result.stats.win_rate}%`}
              color={result.stats.win_rate >= 50 ? 'bull' : 'bear'} />
            <StatCard label="Total P&L"     value={result.stats.total_pnl?.toFixed(2)}
              color={result.stats.total_pnl >= 0 ? 'bull' : 'bear'} />
            <StatCard label="Profit Factor" value={result.stats.profit_factor} />
            <StatCard label="Avg Win"       value={result.stats.avg_win?.toFixed(2)}   color="bull" />
            <StatCard label="Avg Loss"      value={result.stats.avg_loss?.toFixed(2)}  color="bear" />
          </div>

          {/* ── Equity curve ─────────────────────── */}
          {equityData.length > 1 && (
            <div className="card">
              <h2 className="text-sm font-semibold text-gray-200 mb-4">Equity Curve</h2>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={equityData}>
                  <XAxis dataKey="i" hide />
                  <YAxis domain={['auto', 'auto']} tick={{ fontSize: 11, fill: '#6b7280' }} />
                  <Tooltip
                    contentStyle={{ background: '#1a1d23', border: '1px solid #2d3139', borderRadius: 6 }}
                    formatter={v => [`$${v.toFixed(2)}`, 'Equity']}
                    labelFormatter={() => ''}
                  />
                  <ReferenceLine y={10000} stroke="#2d3139" strokeDasharray="3 3" />
                  <Line
                    type="monotone" dataKey="v" stroke="#3b82f6"
                    strokeWidth={2} dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* ── Per-instrument stats ─────────────── */}
          {Object.entries(result.by_instrument).length > 1 && (
            <div className="card overflow-x-auto">
              <h2 className="text-sm font-semibold text-gray-200 mb-3">By Instrument</h2>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-gray-500 border-b border-surface-border">
                    {['Instrument', 'Trades', 'Win %', 'P&L', 'PF'].map(h => (
                      <th key={h} className="pb-2 pr-4 font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(result.by_instrument).map(([sym, s]) => (
                    <tr key={sym} className="border-b border-surface-border/40">
                      <td className="py-2 pr-4 font-mono text-gray-200">{sym.replace('_', '/')}</td>
                      <td className="py-2 pr-4">{s.total_trades}</td>
                      <td className={clsx('py-2 pr-4', s.win_rate >= 50 ? 'text-bull' : 'text-bear')}>
                        {s.win_rate}%
                      </td>
                      <td className={clsx('py-2 pr-4 font-mono', s.total_pnl >= 0 ? 'text-bull' : 'text-bear')}>
                        {s.total_pnl >= 0 ? '+' : ''}{s.total_pnl?.toFixed(2)}
                      </td>
                      <td className="py-2 font-mono">{s.profit_factor}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* ── Daily setups ─────────────────────── */}
          <div className="card overflow-x-auto">
            <h2 className="text-sm font-semibold text-gray-200 mb-3">Daily Setups</h2>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-gray-500 border-b border-surface-border">
                  {['Date', 'Instrument', 'Status', 'Direction', 'OR Range', 'FVG', 'Entry', 'Stop', 'Target'].map(h => (
                    <th key={h} className="pb-2 pr-3 font-medium whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.daily_setups
                  .filter(d => d.opening_range_high != null)
                  .sort((a, b) => b.date.localeCompare(a.date))
                  .map((d, idx) => (
                  <tr key={`${d.instrument}-${d.date}-${idx}`} className="border-b border-surface-border/40">
                    <td className="py-2 pr-3 font-mono text-gray-400">{d.date}</td>
                    <td className="py-2 pr-3 font-mono text-gray-200">{d.instrument.replace('_', '/')}</td>
                    <td className="py-2 pr-3">
                      <span className={clsx('text-xs', (STATUS_META[d.status] || STATUS_META.no_setup).color)}>
                        {(STATUS_META[d.status] || STATUS_META.no_setup).label}
                      </span>
                    </td>
                    <td className="py-2 pr-3">
                      {d.direction ? (
                        <span className={d.direction === 'bullish' ? 'badge-bull' : 'badge-bear'}>
                          {d.direction === 'bullish' ? '▲' : '▼'}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="py-2 pr-3 font-mono text-gray-400">
                      {d.range_size?.toFixed(2) ?? '—'}
                    </td>
                    <td className="py-2 pr-3 font-mono text-gray-400">
                      {d.fvg_top != null
                        ? `${d.fvg_bottom?.toFixed(1)} – ${d.fvg_top?.toFixed(1)}`
                        : '—'}
                    </td>
                    <td className="py-2 pr-3 font-mono">
                      {d.signal?.entry?.toFixed(2) ?? '—'}
                    </td>
                    <td className="py-2 pr-3 font-mono text-bear">
                      {d.signal?.stop?.toFixed(2) ?? '—'}
                    </td>
                    <td className="py-2 font-mono text-bull">
                      {d.signal?.target?.toFixed(2) ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* ── Trade log ────────────────────────── */}
          {result.trades.length > 0 && (
            <div className="card overflow-x-auto">
              <h2 className="text-sm font-semibold text-gray-200 mb-3">Trade Log</h2>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-gray-500 border-b border-surface-border">
                    {['Entry Time', 'Symbol', 'Dir', 'Entry', 'Stop', 'Target', 'Exit', 'Reason', 'P&L'].map(h => (
                      <th key={h} className="pb-2 pr-3 font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.trades.map((t, i) => (
                    <tr key={i} className="border-b border-surface-border/40">
                      <td className="py-2 pr-3 font-mono text-gray-500">
                        {new Date(t.entry_time).toLocaleDateString()}
                      </td>
                      <td className="py-2 pr-3 font-mono text-gray-200">
                        {t.instrument.replace('_', '/')}
                      </td>
                      <td className="py-2 pr-3">
                        <span className={t.direction === 'bullish' ? 'badge-bull' : 'badge-bear'}>
                          {t.direction === 'bullish' ? '▲' : '▼'}
                        </span>
                      </td>
                      <td className="py-2 pr-3 font-mono">{t.entry?.toFixed(2)}</td>
                      <td className="py-2 pr-3 font-mono text-bear">{t.stop?.toFixed(2)}</td>
                      <td className="py-2 pr-3 font-mono text-bull">{t.target?.toFixed(2)}</td>
                      <td className="py-2 pr-3 font-mono">{t.exit_price?.toFixed(2) ?? '—'}</td>
                      <td className="py-2 pr-3 capitalize text-gray-500">{t.exit_reason}</td>
                      <td className={clsx(
                        'py-2 font-mono font-medium',
                        (t.pnl ?? 0) >= 0 ? 'text-bull' : 'text-bear'
                      )}>
                        {t.pnl != null ? `${t.pnl >= 0 ? '+' : ''}${t.pnl.toFixed(2)}` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────────
// Small components
// ──────────────────────────────────────────────────────────────────────────────

function LevelCard({ label, value, color }) {
  return (
    <div className="bg-surface rounded-lg px-3 py-2 text-center">
      <p className="text-xs text-gray-500 mb-0.5">{label}</p>
      <p className={clsx('font-mono text-sm font-medium', color)}>{value ?? '—'}</p>
    </div>
  )
}

function StatCard({ label, value, color }) {
  return (
    <div className="stat-card">
      <span className="stat-label">{label}</span>
      <span className={clsx('stat-value text-lg', color === 'bull' && 'text-bull', color === 'bear' && 'text-bear')}>
        {value}
      </span>
    </div>
  )
}

function Step({ n, title, children }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <span className="w-5 h-5 rounded-full bg-brand/20 text-brand text-xs font-bold flex items-center justify-center">
          {n}
        </span>
        <span className="text-gray-200 font-medium text-xs">{title}</span>
      </div>
      <p className="text-gray-500 text-xs leading-relaxed pl-7">{children}</p>
    </div>
  )
}

function SliderParam({ label, hint, value, displayValue, min, max, step, onChange }) {
  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span className="text-gray-400">{label}</span>
        <span className="text-gray-300 font-mono">{displayValue}</span>
      </div>
      {hint && <p className="text-xs text-gray-600 mb-1">{hint}</p>}
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(+e.target.value)}
        className="w-full accent-brand"
      />
    </div>
  )
}
