import { useState } from 'react'
import { runBacktest, getInstruments } from '../api/client'
import { useEffect } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine
} from 'recharts'
import clsx from 'clsx'

const DEFAULT_PARAMS = {
  min_gap_pct: 0.002,
  max_age_bars: 10,
  entry_pct: 0.5,
  ob_filter_enabled: true,
  ob_lookback: 20,
  ob_min_body_pct: 0.6,
  trend_filter_enabled: true,
  trend_ema_period: 50,
  rr_ratio: 2.0,
  risk_pct: 1.0,
  stop_buffer_pct: 0.1,
  trail_pct: 0.0,
  min_bars_between_signals: 3,
}

const TIMEFRAMES = ['M15', 'M30', 'H1', 'H4', 'D']

export default function Backtest() {
  const [instruments, setInstruments]   = useState([])
  const [selectedInst, setSelectedInst] = useState(['EUR_USD', 'XAU_USD'])
  const [timeframes, setTimeframes]     = useState(['H1'])
  const [lookbackDays, setLookbackDays] = useState(90)
  const [params, setParams]             = useState(DEFAULT_PARAMS)
  const [loading, setLoading]           = useState(false)
  const [error, setError]               = useState(null)
  const [result, setResult]             = useState(null)
  const [activeTab, setActiveTab]       = useState('overview')

  useEffect(() => {
    getInstruments().then(setInstruments).catch(console.error)
  }, [])

  const toggleInst = (sym) =>
    setSelectedInst(prev =>
      prev.includes(sym) ? prev.filter(s => s !== sym) : [...prev, sym]
    )

  const toggleTf = (tf) =>
    setTimeframes(prev =>
      prev.includes(tf)
        ? prev.length > 1 ? prev.filter(t => t !== tf) : prev  // keep at least one
        : [...prev, tf]
    )

  const handleRun = async () => {
    if (!selectedInst.length) return
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const res = await runBacktest({
        instruments:   selectedInst,
        timeframes,
        lookback_days: lookbackDays,
        params,
      })
      setResult(res)
      setActiveTab('overview')
    } catch (err) {
      setError(err?.response?.data?.detail || err.message)
    } finally {
      setLoading(false)
    }
  }

  const setParam = (key, val) => setParams(p => ({ ...p, [key]: val }))

  const equityData   = result?.equity_curve?.map((val, i) => ({ i, value: val })) ?? []
  const startEquity  = equityData[0]?.value ?? 10000
  const finalEquity  = equityData[equityData.length - 1]?.value ?? startEquity
  const totalReturn  = ((finalEquity - startEquity) / startEquity * 100).toFixed(1)

  return (
    <div className="p-6 space-y-6 max-w-screen-xl">
      <h1 className="text-xl font-semibold">Backtest</h1>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">

        {/* ── Settings panel ──────────────────────────────────────── */}
        <div className="xl:col-span-1 space-y-4">

          {/* Instruments */}
          <div className="card">
            <h2 className="text-sm font-semibold mb-3 text-gray-300">Instruments</h2>
            <div className="flex flex-wrap gap-2">
              {instruments.map(inst => (
                <button
                  key={inst.symbol}
                  onClick={() => toggleInst(inst.symbol)}
                  className={clsx(
                    'px-2.5 py-1 rounded text-xs font-mono transition-colors border',
                    selectedInst.includes(inst.symbol)
                      ? 'bg-brand/20 border-brand text-brand'
                      : 'border-surface-border text-gray-500 hover:border-gray-500'
                  )}
                >
                  {inst.name}
                </button>
              ))}
            </div>
          </div>

          {/* Timeframe & period */}
          <div className="card space-y-3">
            <h2 className="text-sm font-semibold text-gray-300">Period</h2>

            <div>
              <label className="text-xs text-gray-400 mb-1 block">
                Timeframes
                <span className="text-gray-600 ml-1">(select one or more)</span>
              </label>
              <div className="flex rounded-lg overflow-hidden border border-surface-border w-fit">
                {TIMEFRAMES.map(tf => (
                  <button
                    key={tf}
                    onClick={() => toggleTf(tf)}
                    className={clsx(
                      'px-3 py-1.5 text-xs font-mono transition-colors',
                      timeframes.includes(tf)
                        ? 'bg-brand text-white'
                        : 'text-gray-400 hover:bg-surface-hover'
                    )}
                  >
                    {tf}
                  </button>
                ))}
              </div>
              {timeframes.length > 1 && (
                <p className="text-xs text-gray-600 mt-1">
                  Results will show per instrument + timeframe combination.
                </p>
              )}
            </div>

            <div>
              <label className="text-xs text-gray-400 mb-1 block">Lookback: {lookbackDays} days</label>
              <input type="range" min={7} max={365} step={7}
                value={lookbackDays} onChange={e => setLookbackDays(+e.target.value)}
                className="w-full accent-brand"
              />
              <div className="flex justify-between text-xs text-gray-500 mt-0.5">
                <span>7d</span><span>1yr</span>
              </div>
            </div>
          </div>

          {/* Strategy params */}
          <div className="card space-y-3">
            <h2 className="text-sm font-semibold text-gray-300">FVG Detection</h2>

            <SliderRow label="Min Gap %" min={0.05} max={1} step={0.05}
              value={(params.min_gap_pct * 100).toFixed(2)}
              displayValue={`${(params.min_gap_pct * 100).toFixed(2)}%`}
              onChange={v => setParam('min_gap_pct', v / 100)} />

            <SliderRow label="Max Age (bars)" min={1} max={50} step={1}
              value={params.max_age_bars}
              displayValue={`${params.max_age_bars} bars`}
              onChange={v => setParam('max_age_bars', v)} />

            <SliderRow label="Entry Position" min={0} max={100} step={5}
              value={+(params.entry_pct * 100)}
              displayValue={`${+(params.entry_pct * 100)}%`}
              onChange={v => setParam('entry_pct', +(v / 100).toFixed(2))} />

            <SliderRow label="Min Bars Between Signals" min={1} max={20} step={1}
              value={params.min_bars_between_signals}
              displayValue={params.min_bars_between_signals}
              onChange={v => setParam('min_bars_between_signals', v)} />
          </div>

          <div className="card space-y-3">
            <h2 className="text-sm font-semibold text-gray-300">Risk Management</h2>

            <SliderRow label="R:R Ratio" min={0.5} max={5} step={0.5}
              value={params.rr_ratio}
              displayValue={`${params.rr_ratio}:1`}
              onChange={v => setParam('rr_ratio', v)} />

            <SliderRow label="Risk Per Trade" min={0.1} max={5} step={0.1}
              value={params.risk_pct}
              displayValue={`${params.risk_pct}%`}
              onChange={v => setParam('risk_pct', v)} />

            <SliderRow label="Stop Buffer" min={0} max={50} step={5}
              value={+(params.stop_buffer_pct * 100)}
              displayValue={`${+(params.stop_buffer_pct * 100)}%`}
              onChange={v => setParam('stop_buffer_pct', +(v / 100).toFixed(2))} />

            <SliderRow label="Trailing Stop" min={0} max={1} step={0.05}
              value={params.trail_pct}
              displayValue={params.trail_pct > 0 ? `${params.trail_pct}%` : 'Off'}
              onChange={v => setParam('trail_pct', +v.toFixed(2))} />
          </div>

          <div className="card space-y-3">
            <h2 className="text-sm font-semibold text-gray-300">Filters</h2>

            <ToggleRow label="OB Filter" value={params.ob_filter_enabled}
              onChange={v => setParam('ob_filter_enabled', v)} />

            <ToggleRow label="Trend (EMA) Filter" value={params.trend_filter_enabled}
              onChange={v => setParam('trend_filter_enabled', v)} />

            {params.trend_filter_enabled && (
              <SliderRow label="EMA Period" min={10} max={200} step={5}
                value={params.trend_ema_period}
                displayValue={`${params.trend_ema_period}-period`}
                onChange={v => setParam('trend_ema_period', v)} />
            )}
          </div>

          <button
            onClick={handleRun}
            disabled={loading || !selectedInst.length}
            className="btn-primary w-full justify-center py-2.5"
          >
            {loading ? 'Running…' : '▶ Run Backtest'}
          </button>
          {error && <p className="text-xs text-bear">{error}</p>}
        </div>

        {/* ── Results ──────────────────────────────────────────────── */}
        <div className="xl:col-span-2 space-y-4">
          {!result && !loading && (
            <div className="card h-64 flex items-center justify-center text-gray-500 text-sm">
              Configure your parameters and click Run Backtest
            </div>
          )}

          {loading && (
            <div className="card h-64 flex items-center justify-center text-gray-400 text-sm">
              Running backtest…
            </div>
          )}

          {result && (
            <>
              {/* Summary stats */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <StatCard label="Win Rate" value={`${result.stats.win_rate}%`}
                  color={result.stats.win_rate >= 50 ? 'bull' : 'bear'} />
                <StatCard label="Total Trades" value={result.stats.total_trades} />
                <StatCard label="Profit Factor"
                  value={result.stats.profit_factor === Infinity ? '∞' : result.stats.profit_factor}
                  color={result.stats.profit_factor >= 1 ? 'bull' : 'bear'} />
                <StatCard label="Total Return" value={`${totalReturn}%`}
                  color={+totalReturn >= 0 ? 'bull' : 'bear'} />
                <StatCard label="Avg Win"      value={`$${result.stats.avg_win}`}      color="bull" />
                <StatCard label="Avg Loss"     value={`$${result.stats.avg_loss}`}     color="bear" />
                <StatCard label="Max Drawdown" value={`$${Math.abs(result.stats.max_drawdown)}`} color="bear" />
                <StatCard label="Targets / Stops"
                  value={`${result.stats.targets_hit} / ${result.stats.stops_hit}`} />
              </div>

              {/* Equity curve */}
              <div className="card">
                <h2 className="text-sm font-semibold mb-3 text-gray-300">Equity Curve</h2>
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={equityData}>
                    <CartesianGrid stroke="#2a2d3a" strokeDasharray="3 3" />
                    <XAxis dataKey="i" hide />
                    <YAxis
                      domain={['auto', 'auto']}
                      tickFormatter={v => `$${(v/1000).toFixed(1)}k`}
                      style={{ fontSize: 11, fill: '#6b7280' }}
                    />
                    <Tooltip
                      contentStyle={{ background: '#1a1d27', border: '1px solid #2a2d3a', borderRadius: 8 }}
                      formatter={v => [`$${v.toFixed(2)}`, 'Equity']}
                      labelFormatter={() => ''}
                    />
                    <ReferenceLine y={startEquity} stroke="#2a2d3a" strokeDasharray="4 4" />
                    <Line
                      type="monotone" dataKey="value"
                      stroke={+totalReturn >= 0 ? '#26a69a' : '#ef5350'}
                      strokeWidth={2} dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              {/* Tabs */}
              <div className="flex gap-1 border-b border-surface-border">
                {['overview', 'trades'].map(tab => (
                  <button key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={clsx(
                      'px-4 py-2 text-sm capitalize transition-colors',
                      tab === activeTab
                        ? 'text-brand border-b-2 border-brand'
                        : 'text-gray-400 hover:text-gray-200'
                    )}
                  >
                    {tab}
                  </button>
                ))}
              </div>

              {activeTab === 'overview' && (
                <div className="space-y-2">
                  <h3 className="text-sm font-medium text-gray-300">By Instrument</h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs text-gray-500 border-b border-surface-border">
                          <th className="pb-2 pr-4">Symbol</th>
                          <th className="pb-2 pr-4">Trades</th>
                          <th className="pb-2 pr-4">Win Rate</th>
                          <th className="pb-2 pr-4">P&L</th>
                          <th className="pb-2 pr-4">Profit Factor</th>
                          <th className="pb-2">Targets / Stops</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Object.entries(result.by_instrument).map(([key, s]) => (
                          <tr key={key} className="border-b border-surface-border/50">
                            <td className="py-2 pr-4 font-mono text-gray-200">
                              {key.replace('_', '/').replace('|', ' · ')}
                            </td>
                            <td className="py-2 pr-4 text-gray-400">{s.total_trades}</td>
                            <td className={clsx('py-2 pr-4', s.win_rate >= 50 ? 'text-bull' : 'text-bear')}>
                              {s.win_rate}%
                            </td>
                            <td className={clsx('py-2 pr-4 font-mono', s.total_pnl >= 0 ? 'text-bull' : 'text-bear')}>
                              ${s.total_pnl}
                            </td>
                            <td className={clsx('py-2 pr-4', s.profit_factor >= 1 ? 'text-bull' : 'text-bear')}>
                              {s.profit_factor === Infinity ? '∞' : s.profit_factor}
                            </td>
                            <td className="py-2 text-gray-400">
                              {s.targets_hit} / {s.stops_hit}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {activeTab === 'trades' && (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-gray-500 border-b border-surface-border">
                        {['Symbol', 'TF', 'Dir', 'Entry', 'Stop', 'Target', 'Exit', 'P&L', 'Result', 'OB'].map(h => (
                          <th key={h} className="pb-2 pr-3">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {result.trades.map((t, i) => (
                        <tr key={i} className="border-b border-surface-border/40">
                          <td className="py-1.5 pr-3 font-mono">{t.instrument.replace('_','/')}</td>
                          <td className="py-1.5 pr-3 text-gray-500">{t.timeframe ?? '—'}</td>
                          <td className="py-1.5 pr-3">
                            <span className={t.direction === 'bullish' ? 'badge-bull' : 'badge-bear'}>
                              {t.direction === 'bullish' ? '▲' : '▼'}
                            </span>
                          </td>
                          <td className="py-1.5 pr-3 font-mono">{t.entry?.toFixed(5)}</td>
                          <td className="py-1.5 pr-3 font-mono text-bear">{t.stop?.toFixed(5)}</td>
                          <td className="py-1.5 pr-3 font-mono text-bull">{t.target?.toFixed(5)}</td>
                          <td className="py-1.5 pr-3 font-mono">{t.exit_price?.toFixed(5) ?? '—'}</td>
                          <td className={clsx('py-1.5 pr-3 font-mono', t.pnl >= 0 ? 'text-bull' : 'text-bear')}>
                            {t.pnl != null ? `$${t.pnl.toFixed(2)}` : '—'}
                          </td>
                          <td className="py-1.5 pr-3">
                            <span className={clsx(
                              'px-1.5 py-0.5 rounded text-xs',
                              t.exit_reason === 'target'  ? 'bg-bull/20 text-bull' :
                              t.exit_reason === 'stop'    ? 'bg-bear/20 text-bear' :
                                                            'bg-gray-700 text-gray-400'
                            )}>
                              {t.exit_reason ?? '—'}
                            </span>
                          </td>
                          <td className="py-1.5 text-gray-500">{t.ob_protected ? '✓' : ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatCard({ label, value, color }) {
  return (
    <div className="stat-card">
      <span className="stat-label">{label}</span>
      <span className={clsx('stat-value', color === 'bull' && 'text-bull', color === 'bear' && 'text-bear')}>
        {value}
      </span>
    </div>
  )
}

function SliderRow({ label, min, max, step, value, displayValue, onChange }) {
  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span className="text-gray-400">{label}</span>
        <span className="text-gray-300 font-mono">{displayValue}</span>
      </div>
      <input type="range" min={min} max={max} step={step}
        value={value} onChange={e => onChange(+e.target.value)}
        className="w-full accent-brand"
      />
    </div>
  )
}

function ToggleRow({ label, value, onChange }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-gray-400">{label}</span>
      <button
        onClick={() => onChange(!value)}
        className={clsx('toggle', value ? 'bg-brand' : 'bg-surface-border')}
      >
        <span className={clsx(
          'inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform',
          value ? 'translate-x-6' : 'translate-x-1'
        )} />
      </button>
    </div>
  )
}
