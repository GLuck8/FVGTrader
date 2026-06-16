import { useState, useEffect, useCallback } from 'react'
import { getScannerConfig, setScannerConfig, getInstruments, analyzeInstrument } from '../api/client'
import clsx from 'clsx'

const TIMEFRAMES = ['M5', 'M15', 'M30', 'H1', 'H4', 'D']

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
  min_bars_between_signals: 3,
}

export default function Config() {
  const [instruments, setInstruments]     = useState([])
  const [config, setConfig]               = useState(null)
  const [saving, setSaving]               = useState(false)
  const [saved, setSaved]                 = useState(false)
  const [error, setError]                 = useState(null)
  const [previewCount, setPreviewCount]   = useState(null)
  const [previewing, setPreviewing]       = useState(false)
  const [previewInst, setPreviewInst]     = useState('EUR_USD')
  const [previewTf, setPreviewTf]         = useState('H1')

  useEffect(() => {
    Promise.all([getInstruments(), getScannerConfig()])
      .then(([insts, cfg]) => {
        setInstruments(insts)
        setConfig(cfg)
      })
      .catch(console.error)
  }, [])

  const setParam = (key, val) =>
    setConfig(c => ({ ...c, params: { ...c.params, [key]: val } }))

  const toggleInst = (sym) =>
    setConfig(c => ({
      ...c,
      instruments: c.instruments.includes(sym)
        ? c.instruments.filter(s => s !== sym)
        : [...c.instruments, sym],
    }))

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    try {
      const updated = await setScannerConfig(config)
      setConfig(updated)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      setError(err?.response?.data?.detail || err.message)
    } finally {
      setSaving(false)
    }
  }

  const handlePreview = useCallback(async () => {
    if (!config) return
    setPreviewing(true)
    setPreviewCount(null)
    try {
      const zones = await analyzeInstrument(previewInst, previewTf, 300, config.params)
      setPreviewCount(zones.length)
    } catch {
      setPreviewCount(null)
    } finally {
      setPreviewing(false)
    }
  }, [config, previewInst, previewTf])

  if (!config) return (
    <div className="p-6 text-gray-400 text-sm">Loading config…</div>
  )

  const p = config.params

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Strategy Configuration</h1>
        <button onClick={handleSave} disabled={saving} className="btn-primary">
          {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save Changes'}
        </button>
      </div>
      {error && <p className="text-xs text-bear">{error}</p>}

      {/* FVG Detection */}
      <Section title="FVG Detection">
        <SliderRow
          label="Minimum Gap Size"
          hint="As % of price. Larger = fewer but stronger signals."
          min={0.05} max={1} step={0.05}
          value={+(p.min_gap_pct * 100).toFixed(2)}
          displayValue={`${(p.min_gap_pct * 100).toFixed(2)}%`}
          onChange={v => setParam('min_gap_pct', +(v / 100).toFixed(5))}
        />
        <SliderRow
          label="Max Gap Age"
          hint="Bars to wait for price to re-enter the gap before expiring."
          min={1} max={50} step={1}
          value={p.max_age_bars}
          displayValue={`${p.max_age_bars} bars`}
          onChange={v => setParam('max_age_bars', v)}
        />
        <SliderRow
          label="Entry Position"
          hint="Where within the gap to enter. 0% = near edge (conservative), 50% = midpoint, 100% = far edge (aggressive)."
          min={0} max={100} step={5}
          value={+(p.entry_pct * 100)}
          displayValue={`${+(p.entry_pct * 100)}%`}
          onChange={v => setParam('entry_pct', +(v / 100).toFixed(2))}
        />
        <SliderRow
          label="Min Bars Between Signals"
          hint="Prevents signal clustering on the same instrument."
          min={1} max={20} step={1}
          value={p.min_bars_between_signals}
          displayValue={p.min_bars_between_signals}
          onChange={v => setParam('min_bars_between_signals', v)}
        />
      </Section>

      {/* Order Block Filter */}
      <Section title="Order Block Filter">
        <ToggleRow
          label="Enable OB Filter"
          hint="Only take signals where an FVG is 'protected' by a higher-timeframe order block."
          value={p.ob_filter_enabled}
          onChange={v => setParam('ob_filter_enabled', v)}
        />
        <SliderRow
          label="OB Lookback"
          hint="How many bars back to look for order blocks."
          min={5} max={100} step={5}
          value={p.ob_lookback}
          displayValue={`${p.ob_lookback} bars`}
          onChange={v => setParam('ob_lookback', v)}
          disabled={!p.ob_filter_enabled}
        />
        <SliderRow
          label="Min OB Body %"
          hint="Minimum candle body-to-range ratio to qualify as an order block. Higher = only strong momentum candles."
          min={30} max={100} step={5}
          value={+(p.ob_min_body_pct * 100)}
          displayValue={`${+(p.ob_min_body_pct * 100)}%`}
          onChange={v => setParam('ob_min_body_pct', +(v / 100).toFixed(2))}
          disabled={!p.ob_filter_enabled}
        />
      </Section>

      {/* Trend Filter */}
      <Section title="Trend Filter (EMA)">
        <ToggleRow
          label="Enable Trend Filter"
          hint="Only take bullish FVGs when price is above the EMA, and bearish FVGs when below."
          value={p.trend_filter_enabled}
          onChange={v => setParam('trend_filter_enabled', v)}
        />
        <SliderRow
          label="EMA Period"
          hint="50-period EMA is the default. 200-period is more conservative."
          min={10} max={200} step={5}
          value={p.trend_ema_period}
          displayValue={`${p.trend_ema_period}-period`}
          onChange={v => setParam('trend_ema_period', v)}
          disabled={!p.trend_filter_enabled}
        />
      </Section>

      {/* Risk Management */}
      <Section title="Risk Management">
        <SliderRow
          label="Risk:Reward Ratio"
          hint="Target = entry + (risk × R:R). 2:1 means $2 gain for every $1 risked."
          min={0.5} max={5} step={0.5}
          value={p.rr_ratio}
          displayValue={`${p.rr_ratio}:1`}
          onChange={v => setParam('rr_ratio', v)}
        />
        <SliderRow
          label="Risk Per Trade"
          hint="% of account balance to risk on each trade."
          min={0.1} max={5} step={0.1}
          value={p.risk_pct}
          displayValue={`${p.risk_pct}%`}
          onChange={v => setParam('risk_pct', v)}
        />
        <SliderRow
          label="Stop Buffer"
          hint="Extra buffer beyond the gap edge for the stop loss, as % of gap size."
          min={0} max={50} step={5}
          value={+(p.stop_buffer_pct * 100)}
          displayValue={`${+(p.stop_buffer_pct * 100)}%`}
          onChange={v => setParam('stop_buffer_pct', +(v / 100).toFixed(2))}
        />
      </Section>

      {/* Scanner config */}
      <Section title="Live Scanner">
        <div>
          <label className="text-xs text-gray-400 mb-1 block">Scan Instruments</label>
          <div className="flex flex-wrap gap-2">
            {instruments.map(inst => (
              <button
                key={inst.symbol}
                onClick={() => toggleInst(inst.symbol)}
                className={clsx(
                  'px-2.5 py-1 rounded text-xs font-mono transition-colors border',
                  config.instruments.includes(inst.symbol)
                    ? 'bg-brand/20 border-brand text-brand'
                    : 'border-surface-border text-gray-500 hover:border-gray-500'
                )}
              >
                {inst.name}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="text-xs text-gray-400 mb-1 block">Scan Timeframes</label>
          <div className="flex rounded-lg overflow-hidden border border-surface-border w-fit">
            {TIMEFRAMES.map(tf => (
              <button
                key={tf}
                onClick={() => setConfig(c => ({
                  ...c,
                  timeframes: c.timeframes.includes(tf)
                    ? c.timeframes.filter(t => t !== tf)
                    : [...c.timeframes, tf]
                }))}
                className={clsx(
                  'px-3 py-1.5 text-xs font-mono transition-colors',
                  config.timeframes.includes(tf)
                    ? 'bg-brand text-white'
                    : 'text-gray-400 hover:bg-surface-hover'
                )}
              >
                {tf}
              </button>
            ))}
          </div>
        </div>

        <SliderRow
          label="Scan Interval"
          hint="How often the scanner polls for new FVG signals."
          min={1} max={60} step={1}
          value={config.interval_minutes}
          displayValue={`Every ${config.interval_minutes} min`}
          onChange={v => setConfig(c => ({ ...c, interval_minutes: v }))}
        />
      </Section>

      {/* Signal preview */}
      <Section title="Signal Preview">
        <p className="text-xs text-gray-500">
          Test your current params against live candles to see how many signals would fire.
        </p>
        <div className="flex items-center gap-3 flex-wrap">
          <select
            className="select w-40 text-sm"
            value={previewInst}
            onChange={e => setPreviewInst(e.target.value)}
          >
            {instruments.map(i => <option key={i.symbol} value={i.symbol}>{i.name}</option>)}
          </select>
          <div className="flex rounded-lg overflow-hidden border border-surface-border">
            {TIMEFRAMES.map(tf => (
              <button
                key={tf}
                onClick={() => setPreviewTf(tf)}
                className={clsx(
                  'px-3 py-1.5 text-xs font-mono transition-colors',
                  tf === previewTf ? 'bg-brand text-white' : 'text-gray-400 hover:bg-surface-hover'
                )}
              >
                {tf}
              </button>
            ))}
          </div>
          <button onClick={handlePreview} disabled={previewing} className="btn-ghost text-sm">
            {previewing ? 'Running…' : 'Preview Signals'}
          </button>
          {previewCount !== null && (
            <span className={clsx('text-sm font-mono', previewCount > 0 ? 'text-bull' : 'text-gray-400')}>
              → {previewCount} signal{previewCount !== 1 ? 's' : ''} on last 300 candles
            </span>
          )}
        </div>
      </Section>
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Section({ title, children }) {
  return (
    <div className="card space-y-4">
      <h2 className="text-sm font-semibold text-gray-200 border-b border-surface-border pb-2">{title}</h2>
      {children}
    </div>
  )
}

function SliderRow({ label, hint, min, max, step, value, displayValue, onChange, disabled }) {
  return (
    <div className={clsx(disabled && 'opacity-40 pointer-events-none')}>
      <div className="flex justify-between text-xs mb-1">
        <span className="text-gray-400">{label}</span>
        <span className="text-gray-300 font-mono">{displayValue}</span>
      </div>
      {hint && <p className="text-xs text-gray-600 mb-1">{hint}</p>}
      <input type="range" min={min} max={max} step={step}
        value={value} onChange={e => onChange(+e.target.value)}
        className="w-full accent-brand"
        disabled={disabled}
      />
    </div>
  )
}

function ToggleRow({ label, hint, value, onChange }) {
  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="text-sm text-gray-300">{label}</span>
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
      {hint && <p className="text-xs text-gray-600 mt-0.5">{hint}</p>}
    </div>
  )
}
