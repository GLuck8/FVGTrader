import { useEffect, useRef, useState, useCallback } from 'react'
import { createChart, CrosshairMode, LineStyle } from 'lightweight-charts'
import { getCandles, analyzeInstrument, getInstruments } from '../api/client'
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

export default function ChartView() {
  const chartContainerRef = useRef(null)
  const chartRef          = useRef(null)
  const candleSeriesRef   = useRef(null)
  const zonesRef          = useRef([])     // drawn primitives to remove on refresh

  const [instruments, setInstruments] = useState([])
  const [instrument, setInstrument]   = useState('EUR_USD')
  const [timeframe, setTimeframe]     = useState('H1')
  const [loading, setLoading]         = useState(false)
  const [error, setError]             = useState(null)
  const [zones, setZones]             = useState([])
  const [showOBOnly, setShowOBOnly]   = useState(false)
  const [candles, setCandles]         = useState([])

  // Load instruments list
  useEffect(() => {
    getInstruments().then(setInstruments).catch(console.error)
  }, [])

  // Create chart once
  useEffect(() => {
    if (!chartContainerRef.current) return

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { color: '#1a1d27' },
        textColor:  '#9ca3af',
      },
      grid: {
        vertLines: { color: '#2a2d3a' },
        horzLines: { color: '#2a2d3a' },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: '#2a2d3a' },
      timeScale: {
        borderColor: '#2a2d3a',
        timeVisible: true,
        secondsVisible: false,
      },
    })

    const candleSeries = chart.addCandlestickSeries({
      upColor:         '#26a69a',
      downColor:       '#ef5350',
      borderUpColor:   '#26a69a',
      borderDownColor: '#ef5350',
      wickUpColor:     '#26a69a',
      wickDownColor:   '#ef5350',
    })

    chartRef.current        = chart
    candleSeriesRef.current = candleSeries

    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({ width: chartContainerRef.current.clientWidth })
      }
    }
    window.addEventListener('resize', handleResize)
    return () => {
      window.removeEventListener('resize', handleResize)
      chart.remove()
    }
  }, [])

  // Fetch & render data
  const loadData = useCallback(async () => {
    if (!candleSeriesRef.current) return
    setLoading(true)
    setError(null)

    try {
      const [rawCandles, rawZones] = await Promise.all([
        getCandles(instrument, timeframe, 300),
        analyzeInstrument(instrument, timeframe, 300, DEFAULT_PARAMS),
      ])

      // Format for lightweight-charts
      const formatted = rawCandles.map(c => ({
        time:  Math.floor(new Date(c.time).getTime() / 1000),
        open:  c.open,
        high:  c.high,
        low:   c.low,
        close: c.close,
      }))
      candleSeriesRef.current.setData(formatted)
      setCandles(rawCandles)

      // Clear old zone series
      zonesRef.current.forEach(s => {
        try { chartRef.current?.removeSeries(s) } catch (_) {}
      })
      zonesRef.current = []

      const visibleZones = showOBOnly ? rawZones.filter(z => z.ob_protected) : rawZones
      setZones(visibleZones)

      // Draw FVG zones as horizontal bands
      visibleZones.forEach(zone => {
        const isBull = zone.direction === 'bullish'
        const color  = isBull ? 'rgba(38,166,154,0.15)' : 'rgba(239,83,80,0.15)'
        const border = isBull ? 'rgba(38,166,154,0.6)'  : 'rgba(239,83,80,0.6)'

        // Top line
        const topLine = chartRef.current.addLineSeries({
          color:      border,
          lineWidth:  1,
          lineStyle:  LineStyle.Dashed,
          lastValueVisible: false,
          priceLineVisible: false,
        })
        // Bottom line
        const botLine = chartRef.current.addLineSeries({
          color:      border,
          lineWidth:  1,
          lineStyle:  LineStyle.Dashed,
          lastValueVisible: false,
          priceLineVisible: false,
        })

        const startTime = Math.floor(new Date(zone.timestamp).getTime() / 1000)
        const endTime   = formatted[formatted.length - 1]?.time ?? startTime

        topLine.setData([{ time: startTime, value: zone.top    }, { time: endTime, value: zone.top    }])
        botLine.setData([{ time: startTime, value: zone.bottom }, { time: endTime, value: zone.bottom }])

        // Midpoint line (entry)
        const midLine = chartRef.current.addLineSeries({
          color:      border,
          lineWidth:  1,
          lineStyle:  LineStyle.Dotted,
          lastValueVisible: false,
          priceLineVisible: false,
        })
        midLine.setData([{ time: startTime, value: zone.midpoint }, { time: endTime, value: zone.midpoint }])

        zonesRef.current.push(topLine, botLine, midLine)

        // OB-protected badge (price line marker)
        if (zone.ob_protected) {
          topLine.createPriceLine({
            price:     zone.top,
            color:     border,
            lineWidth: 1,
            lineStyle: LineStyle.Solid,
            axisLabelVisible: true,
            title: isBull ? '🟢 OB' : '🔴 OB',
          })
        }
      })

      chartRef.current?.timeScale().fitContent()
    } catch (err) {
      setError(err?.response?.data?.detail || err.message)
    } finally {
      setLoading(false)
    }
  }, [instrument, timeframe, showOBOnly])

  useEffect(() => { loadData() }, [loadData])

  const bullZones = zones.filter(z => z.direction === 'bullish')
  const bearZones = zones.filter(z => z.direction === 'bearish')
  const obCount   = zones.filter(z => z.ob_protected).length

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-surface-border flex-shrink-0 flex-wrap">
        <h1 className="text-sm font-semibold text-gray-200 mr-2">Chart</h1>

        <select
          className="select w-36 text-sm"
          value={instrument}
          onChange={e => setInstrument(e.target.value)}
        >
          {instruments.map(i => (
            <option key={i.symbol} value={i.symbol}>{i.name}</option>
          ))}
        </select>

        <div className="flex rounded-lg overflow-hidden border border-surface-border">
          {TIMEFRAMES.map(tf => (
            <button
              key={tf}
              onClick={() => setTimeframe(tf)}
              className={clsx(
                'px-3 py-1.5 text-xs font-mono font-medium transition-colors',
                tf === timeframe
                  ? 'bg-brand text-white'
                  : 'text-gray-400 hover:bg-surface-hover hover:text-gray-200'
              )}
            >
              {tf}
            </button>
          ))}
        </div>

        <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer ml-2">
          <input
            type="checkbox"
            checked={showOBOnly}
            onChange={e => setShowOBOnly(e.target.checked)}
            className="rounded border-surface-border accent-brand"
          />
          OB-protected only
        </label>

        <button onClick={loadData} className="btn-ghost text-sm ml-auto" disabled={loading}>
          {loading ? 'Loading…' : '↻ Refresh'}
        </button>
      </div>

      {/* Stats bar */}
      <div className="flex items-center gap-4 px-4 py-2 border-b border-surface-border bg-surface text-xs flex-shrink-0">
        <span className="text-gray-500">{candles.length} candles</span>
        <span className="text-bull">▲ {bullZones.length} bullish FVGs</span>
        <span className="text-bear">▼ {bearZones.length} bearish FVGs</span>
        {obCount > 0 && <span className="text-brand">{obCount} OB-protected</span>}
        {error && <span className="text-bear ml-auto">⚠ {error}</span>}
      </div>

      {/* Chart */}
      <div className="flex-1 relative">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-surface/60 z-10">
            <div className="text-sm text-gray-400">Loading chart…</div>
          </div>
        )}
        <div ref={chartContainerRef} className="w-full h-full" />
      </div>

      {/* Zone legend */}
      {zones.length > 0 && (
        <div className="flex-shrink-0 border-t border-surface-border px-4 py-2 flex gap-4 text-xs text-gray-500">
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 h-0.5 bg-bull" /> Bullish FVG
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 h-0.5 bg-bear" /> Bearish FVG
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 border-t border-dashed border-gray-400" /> Midpoint (entry)
          </span>
          <span className="ml-auto">OB = Order Block protected</span>
        </div>
      )}
    </div>
  )
}
