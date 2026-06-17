/**
 * Bollinger Band + RSI Strategy page
 *
 * Tab 1 — Live Signals: scan recent candles for active BB+RSI snap-back setups
 * Tab 2 — Backtest:     historical simulation with stats, equity curve, trade log
 */

import { useState, useEffect, useCallback } from 'react'
import { getBBRSISignals, runBBRSIBacktest, getInstruments } from '../api/client'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts'
import clsx from 'clsx'

// ──────────────────────────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────────────────────────

const TIMEFRAMES = ['M15', 'M30', 'H1', 'H4', 'D']

const DEFAULT_PARAMS = {
  bb_period: 20,
  bb_std: 2.0,
  rsi_period: 14,
  rsi_oversold: 30,
  rsi_overbought: 70,
  stop_buffer_pct: 0.1,
  max_age_bars: 20,
  risk_pct: 1.0,
  trail_pct: 0.0,
  trend_filter_enabled: false,
  trend_ema_period: 100,
  min_bars_between_signals: 5,
}

const ALL_INSTRUMENTS = [
  'EUR_USD', 'GBP_USD', 'USD_JPY', 'AUD_USD',
  'XAU_USD', 'SPX500_USD', 'NAS100_USD', 'BTC_USD',
]

// ──────────────────────────────────────────────────────────────────────────────
// Page
// ──────────────────────────────────────────────────────────────────────────────

export default function BBRSIStrategy() {
  const [activeTab, setActiveTab] = useState('signals')

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">BB + RSI Strategy</h1>
          <p className="text-xs text-gray-500 mt-0.5">
            Bollinger Band snap-back · RSI confirmation · Mean-reversion to SMA
          </p>
        </div>
        <div className="flex rounded-lg overflow-hidden border border-surface-border">
          {['signals', 'backtest'].map(tab => (
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
              {tab === 'signals' ? 'Live Signals' : 'Backtest'}
            </button>
          ))}
        </div>
      </div>

      {activeTab === 'signals' ? <SignalsTab /> : <BacktestTab />}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────────
// Live Signals tab
// ──────────────────────────────────────────────────────────────────────────────

function SignalsTab() {
  const [instrument, setInstrument] = useState('EUR_USD')
  const [timeframe,  setTimeframe]  = useState('H1')
  const [signals,    setSignals]    = useState([])
  const [loading,    setLoading]    = useState(false)
  const [error,      setError]      = useState(null)
  const [params,     setParams]     = useState(DEFAULT_PARAMS)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await getBBRSISignals(instrument, timeframe, 500, params)
      // Show most recent 20 signals
      setSignals([...data].reverse().slice(0, 20))
    } catch (err) {
      setError(err?.response?.data?.detail || 'Failed to fetch signals')
    } finally {
      setLoading(false)
    }
  }, [instrument, timeframe, params])

  useEffect(() => { refresh() }, [refresh])

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

      {/* Controls */}
      <div className="card space-y-4 lg:col-span-1">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-200">Scanner</h2>
          <button onClick={refresh} disabled={loading} className="btn-ghost text-sm">
            {loading ? '…' : '↻ Refresh'}
          </button>
        </div>

        {/* Instrument */}
        <div>
          <label className="text-xs text-gray-400 mb-1 block">Instrument</label>
          <select
            className="select w-full text-sm"
            value={instrument}
            onChange={e => setInstrument(e.target.value)}
          >
            {ALL_INSTRUMENTS.map(sym => (
              <option key={sym} value={sym}>{sym.replace('_', '/')}</option>
            ))}
          </select>
        </div>

        {/* Timeframe */}
        <div>
          <label className="text-xs text-gray-400 mb-1 block">Timeframe</label>
          <div className="flex rounded-lg overflow-hidden border border-surface-border">
            {TIMEFRAMES.map(tf => (
              <button
                key={tf}
                onClick={() => setTimeframe(tf)}
                className={clsx(
                  'flex-1 py-1.5 text-xs font-mono transition-colors',
                  tf === timeframe ? 'bg-brand text-white' : 'text-gray-400 hover:bg-surface-hover'
                )}
              >
                {tf}
              </button>
            ))}
          </div>
        </div>

        {/* BB params */}
        <ParamSlider label="BB Period" min={5} max={50} step={1}
          value={params.bb_period} display={`${params.bb_period}`}
          onChange={v => setParams(p => ({ ...p, bb_period: v }))} />
        <ParamSlider label="BB Std Dev" min={1.0} max={3.0} step={0.5}
          value={params.bb_std} display={`${params.bb_std}σ`}
          onChange={v => setParams(p => ({ ...p, bb_std: v }))} />
        <ParamSlider label="RSI Period" min={5} max={30} step={1}
          value={params.rsi_period} display={`${params.rsi_period}`}
          onChange={v => setParams(p => ({ ...p, rsi_period: v }))} />
        <ParamSlider label="RSI Oversold" min={10} max={45} step={1}
          value={params.rsi_oversold} display={`< ${params.rsi_oversold}`}
          onChange={v => setParams(p => ({ ...p, rsi_oversold: v }))} />
        <ParamSlider label="RSI Overbought" min={55} max={90} step={1}
          value={params.rsi_overbought} display={`> ${params.rsi_overbought}`}
          onChange={v => setParams(p => ({ ...p, rsi_overbought: v }))} />

        {error && <p className="text-bear text-xs">{error}</p>}
      </div>

      {/* Signal list */}
      <div className="card lg:col-span-2 space-y-3">
        <h2 className="text-sm font-semibold text-gray-200">
          Recent Signals
          {signals.length > 0 && (
            <span className="ml-2 text-gray-500 font-normal">{signals.length} found</span>
          )}
        </h2>

        {loading && <p className="text-gray-500 text-sm">Loading…</p>}

        {!loading && signals.length === 0 && (
          <p className="text-gray-500 text-sm">
            No BB+RSI signals in the last 500 candles for this instrument/timeframe.
            Try a different timeframe or relax RSI thresholds.
          </p>
        )}

        <div className="space-y-2 max-h-[600px] overflow-y-auto pr-1">
          {signals.map((sig, i) => (
            <SignalCard key={i} sig={sig} />
          ))}
        </div>
      </div>
    </div>
  )
}

function SignalCard({ sig }) {
  const isBull = sig.direction === 'bullish'
  const rr     = ((Math.abs(sig.target - sig.entry)) / Math.abs(sig.entry - sig.stop)).toFixed(1)

  return (
    <div className={clsx(
      'rounded-lg border p-3 space-y-1.5',
      isBull ? 'border-bull/30 bg-bull/5' : 'border-bear/30 bg-bear/5'
    )}>
      <div className="flex items-center justify-between text-xs">
        <span className={clsx('font-semibold', isBull ? 'text-bull' : 'text-bear')}>
          {isBull ? '▲ LONG' : '▼ SHORT'} · {sig.timeframe}
        </span>
        <span className="text-gray-500 font-mono">
          {new Date(sig.timestamp).toLocaleString()}
        </span>
      </div>
      <div className="grid grid-cols-4 gap-2 text-xs font-mono">
        <PriceItem label="Entry"  value={sig.entry}  color="text-gray-200" />
        <PriceItem label="Stop"   value={sig.stop}   color="text-bear" />
        <PriceItem label="Target" value={sig.target} color="text-bull" />
        <div>
          <div className="text-gray-500">R:R</div>
          <div className="text-brand font-semibold">{rr}:1</div>
        </div>
      </div>
      <div className="flex gap-4 text-xs text-gray-500">
        <span>RSI at signal: <span className={clsx('font-mono', sig.rsi_value < 35 ? 'text-bull' : sig.rsi_value > 65 ? 'text-bear' : 'text-gray-400')}>{sig.rsi_value}</span></span>
        <span>Band: <span className="font-mono text-gray-400">{sig.band_bot.toFixed(4)} – {sig.band_top.toFixed(4)}</span></span>
        <span>Mid: <span className="font-mono text-brand">{sig.band_mid.toFixed(4)}</span></span>
      </div>
    </div>
  )
}

function PriceItem({ label, value, color }) {
  return (
    <div>
      <div className="text-gray-500">{label}</div>
      <div className={clsx('font-semibold', color)}>{value.toFixed(4)}</div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────────
// Backtest tab
// ──────────────────────────────────────────────────────────────────────────────

function BacktestTab() {
  const [result,    setResult]    = useState(null)
  const [loading,   setLoading]   = useState(false)
  const [error,     setError]     = useState(null)
  const [timeframe, setTimeframe] = useState('H1')
  const [lookback,  setLookback]  = useState(90)
  const [params,    setParams]    = useState(DEFAULT_PARAMS)
  const [selected,  setSelected]  = useState(['EUR_USD', 'GBP_USD', 'XAU_USD'])

  const toggleInst = sym =>
    setSelected(prev =>
      prev.includes(sym) ? prev.filter(s => s !== sym) : [...prev, sym]
    )

  const handleRun = async () => {
    if (selected.length === 0) return
    setLoading(true)
    setError(null)
    try {
      const data = await runBBRSIBacktest({
        instruments: selected,
        timeframe,
        lookback_days: lookback,
        params,
      })
      setResult(data)
    } catch (err) {
      setError(err?.response?.data?.detail || 'Backtest failed')
    } finally {
      setLoading(false)
    }
  }

  const equityData = result?.equity_curve.map((v, i) => ({ i, value: v })) ?? []
  const stats      = result?.stats

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

      {/* ── Params sidebar ── */}
      <div className="card space-y-4">
        <h2 className="text-sm font-semibold text-gray-200">Parameters</h2>

        {/* Instruments */}
        <div>
          <label className="text-xs text-gray-400 mb-1 block">Instruments</label>
          <div className="flex flex-wrap gap-1.5">
            {ALL_INSTRUMENTS.map(sym => (
              <button
                key={sym}
                onClick={() => toggleInst(sym)}
                className={clsx(
                  'px-2 py-0.5 rounded text-xs font-mono border transition-colors',
                  selected.includes(sym)
                    ? 'bg-brand/20 border-brand text-brand'
                    : 'border-surface-border text-gray-500 hover:border-gray-500'
                )}
              >
                {sym.replace('_', '/')}
              </button>
            ))}
          </div>
        </div>

        {/* Timeframe */}
        <div>
          <label className="text-xs text-gray-400 mb-1 block">Timeframe</label>
          <div className="flex rounded-lg overflow-hidden border border-surface-border">
            {TIMEFRAMES.map(tf => (
              <button key={tf} onClick={() => setTimeframe(tf)}
                className={clsx(
                  'flex-1 py-1.5 text-xs font-mono transition-colors',
                  tf === timeframe ? 'bg-brand text-white' : 'text-gray-400 hover:bg-surface-hover'
                )}>
                {tf}
              </button>
            ))}
          </div>
        </div>

        <ParamSlider label="Lookback" min={30} max={365} step={30}
          value={lookback} display={`${lookback} days`}
          onChange={v => setLookback(v)} />

        <hr className="border-surface-border" />

        <ParamSlider label="BB Period" min={5} max={50} step={1}
          value={params.bb_period} display={`${params.bb_period}`}
          onChange={v => setParams(p => ({ ...p, bb_period: v }))} />
        <ParamSlider label="BB Std Dev" min={1.0} max={3.0} step={0.5}
          value={params.bb_std} display={`${params.bb_std}σ`}
          onChange={v => setParams(p => ({ ...p, bb_std: v }))} />
        <ParamSlider label="RSI Period" min={5} max={30} step={1}
          value={params.rsi_period} display={`${params.rsi_period}`}
          onChange={v => setParams(p => ({ ...p, rsi_period: v }))} />
        <ParamSlider label="RSI Oversold" min={10} max={45} step={1}
          value={params.rsi_oversold} display={`< ${params.rsi_oversold}`}
          onChange={v => setParams(p => ({ ...p, rsi_oversold: v }))} />
        <ParamSlider label="RSI Overbought" min={55} max={90} step={1}
          value={params.rsi_overbought} display={`> ${params.rsi_overbought}`}
          onChange={v => setParams(p => ({ ...p, rsi_overbought: v }))} />
        <ParamSlider label="Stop Buffer" min={0} max={50} step={5}
          value={+(params.stop_buffer_pct * 100)} display={`${+(params.stop_buffer_pct * 100)}%`}
          onChange={v => setParams(p => ({ ...p, stop_buffer_pct: +(v / 100).toFixed(2) }))} />
        <ParamSlider label="Max Hold Bars" min={5} max={100} step={5}
          value={params.max_age_bars} display={`${params.max_age_bars} bars`}
          onChange={v => setParams(p => ({ ...p, max_age_bars: v }))} />
        <ParamSlider label="Risk Per Trade" min={0.1} max={5} step={0.1}
          value={params.risk_pct} display={`${params.risk_pct}%`}
          onChange={v => setParams(p => ({ ...p, risk_pct: v }))} />
        <ParamSlider label="Trailing Stop" min={0} max={1} step={0.05}
          value={params.trail_pct}
          display={params.trail_pct > 0 ? `${params.trail_pct}%` : 'Off'}
          onChange={v => setParams(p => ({ ...p, trail_pct: +v.toFixed(2) }))} />

        {/* Trend filter toggle */}
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-400">Trend Filter (EMA)</span>
          <button
            onClick={() => setParams(p => ({ ...p, trend_filter_enabled: !p.trend_filter_enabled }))}
            className={clsx('toggle', params.trend_filter_enabled ? 'bg-brand' : 'bg-surface-border')}
          >
            <span className={clsx(
              'inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform',
              params.trend_filter_enabled ? 'translate-x-6' : 'translate-x-1'
            )} />
          </button>
        </div>
        {params.trend_filter_enabled && (
          <ParamSlider label="Trend EMA" min={20} max={200} step={10}
            value={params.trend_ema_period} display={`${params.trend_ema_period}-period`}
            onChange={v => setParams(p => ({ ...p, trend_ema_period: v }))} />
        )}

        <button
          onClick={handleRun}
          disabled={loading || selected.length === 0}
          className="btn-primary w-full"
        >
          {loading ? 'Running…' : 'Run Backtest'}
        </button>
        {error && <p className="text-bear text-xs">{error}</p>}
      </div>

      {/* ── Results ── */}
      <div className="lg:col-span-2 space-y-4">

        {/* Stats grid */}
        {stats && (
          <div className="card">
            <h2 className="text-sm font-semibold text-gray-200 mb-3">Results</h2>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
              <StatBox label="Trades"   value={stats.total_trades} />
              <StatBox label="Win Rate" value={`${stats.win_rate}%`}
                color={stats.win_rate >= 50 ? 'text-bull' : 'text-bear'} />
              <StatBox label="Total P&L" value={`$${stats.total_pnl.toFixed(0)}`}
                color={stats.total_pnl >= 0 ? 'text-bull' : 'text-bear'} />
              <StatBox label="Avg Win"  value={`$${stats.avg_win.toFixed(0)}`} color="text-bull" />
              <StatBox label="Avg Loss" value={`$${stats.avg_loss.toFixed(0)}`} color="text-bear" />
              <StatBox label="Prof. Factor" value={stats.profit_factor === Infinity ? '∞' : stats.profit_factor}
                color={stats.profit_factor >= 1.5 ? 'text-bull' : 'text-bear'} />
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 mt-3">
              <StatBox label="Max DD"    value={`$${Math.abs(stats.max_drawdown).toFixed(0)}`} color="text-bear" />
              <StatBox label="Targets"  value={stats.targets_hit} color="text-bull" />
              <StatBox label="Stops"    value={stats.stops_hit}   color="text-bear" />
              <StatBox label="Expired"  value={stats.total_trades - stats.targets_hit - stats.stops_hit} />
              <StatBox label="Wins"     value={stats.wins}  color="text-bull" />
              <StatBox label="Losses"   value={stats.losses} color="text-bear" />
            </div>

            {/* By-instrument breakdown */}
            {result.by_instrument && Object.keys(result.by_instrument).length > 1 && (
              <div className="mt-4 border-t border-surface-border pt-3">
                <p className="text-xs text-gray-400 mb-2">By Instrument</p>
                <div className="space-y-1">
                  {Object.entries(result.by_instrument).map(([sym, s]) => (
                    <div key={sym} className="flex items-center justify-between text-xs font-mono">
                      <span className="text-gray-400 w-28">{sym.replace('_', '/')}</span>
                      <span>{s.total_trades} trades</span>
                      <span className={s.win_rate >= 50 ? 'text-bull' : 'text-bear'}>{s.win_rate}% WR</span>
                      <span className={s.total_pnl >= 0 ? 'text-bull' : 'text-bear'}>${s.total_pnl.toFixed(0)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Equity curve */}
        {equityData.length > 1 && (
          <div className="card">
            <h2 className="text-sm font-semibold text-gray-200 mb-3">Equity Curve</h2>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={equityData}>
                <XAxis dataKey="i" hide />
                <YAxis
                  domain={['auto', 'auto']}
                  tickFormatter={v => `$${(v / 1000).toFixed(1)}k`}
                  tick={{ fontSize: 11, fill: '#6b7280' }}
                  width={55}
                />
                <Tooltip
                  formatter={v => [`$${v.toFixed(2)}`, 'Equity']}
                  contentStyle={{ background: '#1a1a2e', border: '1px solid #333', fontSize: 12 }}
                />
                <ReferenceLine y={10000} stroke="#374151" strokeDasharray="4 2" />
                <Line
                  type="monotone" dataKey="value" stroke="#6366f1"
                  dot={false} strokeWidth={2}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Trade log */}
        {result?.trades?.length > 0 && (
          <div className="card">
            <h2 className="text-sm font-semibold text-gray-200 mb-3">Trade Log</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-xs font-mono">
                <thead>
                  <tr className="text-gray-500 border-b border-surface-border">
                    <th className="text-left pb-2 pr-3">Instrument</th>
                    <th className="text-left pb-2 pr-3">Dir</th>
                    <th className="text-right pb-2 pr-3">Entry</th>
                    <th className="text-right pb-2 pr-3">Stop</th>
                    <th className="text-right pb-2 pr-3">Target</th>
                    <th className="text-right pb-2 pr-3">Exit</th>
                    <th className="text-left pb-2 pr-3">Reason</th>
                    <th className="text-right pb-2">P&L</th>
                  </tr>
                </thead>
                <tbody>
                  {result.trades.slice(-100).reverse().map((t, i) => (
                    <tr key={i} className="border-b border-surface-border/50 hover:bg-surface-hover/30">
                      <td className="py-1.5 pr-3 text-gray-400">{t.instrument.replace('_', '/')}</td>
                      <td className={clsx('py-1.5 pr-3 font-semibold', t.direction === 'bullish' ? 'text-bull' : 'text-bear')}>
                        {t.direction === 'bullish' ? '▲' : '▼'}
                      </td>
                      <td className="py-1.5 pr-3 text-right">{t.entry.toFixed(4)}</td>
                      <td className="py-1.5 pr-3 text-right text-bear">{t.stop.toFixed(4)}</td>
                      <td className="py-1.5 pr-3 text-right text-bull">{t.target.toFixed(4)}</td>
                      <td className="py-1.5 pr-3 text-right">{t.exit_price?.toFixed(4) ?? '—'}</td>
                      <td className="py-1.5 pr-3">
                        <span className={clsx(
                          'px-1.5 py-0.5 rounded text-xs',
                          t.exit_reason === 'target'  ? 'bg-bull/20 text-bull' :
                          t.exit_reason === 'stop'    ? 'bg-bear/20 text-bear' :
                                                        'bg-gray-700 text-gray-400'
                        )}>
                          {t.exit_reason}
                        </span>
                      </td>
                      <td className={clsx('py-1.5 text-right font-semibold', (t.pnl ?? 0) >= 0 ? 'text-bull' : 'text-bear')}>
                        {t.pnl != null ? `$${t.pnl.toFixed(2)}` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {!result && !loading && (
          <div className="card text-gray-500 text-sm text-center py-12">
            Configure parameters and click Run Backtest
          </div>
        )}
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────────
// Shared sub-components
// ──────────────────────────────────────────────────────────────────────────────

function ParamSlider({ label, min, max, step, value, display, onChange }) {
  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span className="text-gray-400">{label}</span>
        <span className="text-gray-300 font-mono">{display}</span>
      </div>
      <input
        type="range" min={min} max={max} step={step}
        value={value} onChange={e => onChange(+e.target.value)}
        className="w-full accent-brand"
      />
    </div>
  )
}

function StatBox({ label, value, color = 'text-gray-200' }) {
  return (
    <div className="bg-surface-hover rounded-lg p-2 text-center">
      <div className="text-xs text-gray-500 mb-0.5">{label}</div>
      <div className={clsx('text-sm font-semibold font-mono', color)}>{value}</div>
    </div>
  )
}
