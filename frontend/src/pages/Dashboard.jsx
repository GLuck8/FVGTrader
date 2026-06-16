import { useState, useEffect, useCallback } from 'react'
import {
  getAccount, getPositions, getScannerStatus, setScannerConfig,
  getScannerSignals, clearSignals, closePosition
} from '../api/client'
import clsx from 'clsx'

const REFRESH_MS = 15000

export default function Dashboard() {
  const [account, setAccount]     = useState(null)
  const [positions, setPositions] = useState([])
  const [scanner, setScanner]     = useState(null)
  const [signals, setSignals]     = useState([])
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState(null)
  const [closing, setClosing]     = useState(null)

  const refresh = useCallback(async () => {
    try {
      const [acc, pos, scan, sigs] = await Promise.all([
        getAccount(),
        getPositions(),
        getScannerStatus(),
        getScannerSignals(20),
      ])
      setAccount(acc)
      setPositions(pos)
      setScanner(scan)
      setSignals(sigs)
      setError(null)
    } catch (err) {
      setError(err?.response?.data?.detail || 'Cannot reach backend')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
    const t = setInterval(refresh, REFRESH_MS)
    return () => clearInterval(t)
  }, [refresh])

  const toggleScanner = async () => {
    if (!scanner) return
    try {
      const newCfg = { ...scanner.config, enabled: !scanner.running }
      await setScannerConfig(newCfg)
      await refresh()
    } catch (err) {
      setError(err?.response?.data?.detail || 'Failed to toggle scanner')
    }
  }

  const handleClosePosition = async (instrument) => {
    setClosing(instrument)
    try {
      await closePosition(instrument)
      await refresh()
    } catch (err) {
      setError(`Failed to close ${instrument}: ${err?.response?.data?.detail || err.message}`)
    } finally {
      setClosing(null)
    }
  }

  const handleClearSignals = async () => {
    await clearSignals()
    setSignals([])
  }

  if (loading) return (
    <div className="p-6 text-gray-400 text-sm">Connecting to backend…</div>
  )

  if (error && !account) return (
    <div className="p-6">
      <div className="card border-bear/30 bg-bear/10">
        <p className="text-bear text-sm">⚠ {error}</p>
        <p className="text-gray-500 text-xs mt-1">
          Make sure the backend is running: <code className="font-mono">uvicorn app.main:app --reload --port 8000</code>
        </p>
      </div>
    </div>
  )

  const isLive      = account?.environment === 'live'
  const totalUpnl   = positions.reduce((s, p) => s + p.unrealized_pnl, 0)

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Dashboard</h1>
        <div className="flex items-center gap-3">
          {error && <span className="text-xs text-bear">⚠ {error}</span>}
          <button onClick={refresh} className="btn-ghost text-sm">↻ Refresh</button>
        </div>
      </div>

      {isLive && (
        <div className="card border-bear/40 bg-bear/10">
          <p className="text-bear text-sm font-medium">⚠ LIVE TRADING MODE — Real money at risk</p>
        </div>
      )}

      {/* Account summary */}
      {account && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard label="Balance" value={`${account.currency} ${account.balance.toFixed(2)}`} />
          <StatCard label="NAV"     value={`${account.currency} ${account.nav.toFixed(2)}`} />
          <StatCard
            label="Open P&L"
            value={`${totalUpnl >= 0 ? '+' : ''}${totalUpnl.toFixed(2)}`}
            color={totalUpnl >= 0 ? 'bull' : 'bear'}
          />
          <StatCard label="Open Trades" value={account.open_trade_count} />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* ── Scanner ─────────────────────────────────────────────── */}
        <div className="card space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-200">Live Scanner</h2>
            {scanner && (
              <button
                onClick={toggleScanner}
                className={clsx(
                  'btn text-xs',
                  scanner.running ? 'btn-danger' : 'btn-primary'
                )}
              >
                {scanner.running ? '■ Stop' : '▶ Start'}
              </button>
            )}
          </div>

          {scanner && (
            <div className="space-y-2 text-sm">
              <Row label="Status">
                <span className={clsx('font-medium', scanner.running ? 'text-bull' : 'text-gray-400')}>
                  {scanner.running ? '● Running' : '○ Stopped'}
                </span>
              </Row>
              <Row label="Instruments">
                <span className="font-mono text-gray-300 text-xs">
                  {scanner.config.instruments?.join(', ') || '—'}
                </span>
              </Row>
              <Row label="Timeframes">
                <span className="font-mono text-gray-300 text-xs">
                  {scanner.config.timeframes?.join(', ') || '—'}
                </span>
              </Row>
              <Row label="Interval">
                <span className="font-mono text-gray-300">Every {scanner.config.interval_minutes} min</span>
              </Row>
              <Row label="Signals captured">
                <span className="font-mono text-gray-300">{scanner.signal_count}</span>
              </Row>
            </div>
          )}
        </div>

        {/* ── Open Positions ───────────────────────────────────────── */}
        <div className="card space-y-3">
          <h2 className="text-sm font-semibold text-gray-200">Open Positions</h2>

          {positions.length === 0 ? (
            <p className="text-gray-500 text-sm">No open positions</p>
          ) : (
            <div className="space-y-2">
              {positions.map(pos => (
                <div key={pos.instrument}
                  className="flex items-center justify-between bg-surface rounded-lg px-3 py-2.5">
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm text-gray-200">
                        {pos.instrument.replace('_', '/')}
                      </span>
                      <span className={pos.direction === 'bullish' ? 'badge-bull' : 'badge-bear'}>
                        {pos.direction === 'bullish' ? '▲ Long' : '▼ Short'}
                      </span>
                    </div>
                    <div className="text-xs text-gray-500 font-mono">
                      {pos.units} units @ {pos.avg_price}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className={clsx(
                      'font-mono text-sm font-medium',
                      pos.unrealized_pnl >= 0 ? 'text-bull' : 'text-bear'
                    )}>
                      {pos.unrealized_pnl >= 0 ? '+' : ''}{pos.unrealized_pnl.toFixed(2)}
                    </div>
                    <button
                      onClick={() => handleClosePosition(pos.instrument)}
                      disabled={closing === pos.instrument}
                      className="btn-danger text-xs mt-1"
                    >
                      {closing === pos.instrument ? '…' : 'Close'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Recent Signals ────────────────────────────────────────────── */}
      <div className="card space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-200">Recent Signals</h2>
          {signals.length > 0 && (
            <button onClick={handleClearSignals} className="btn-ghost text-xs">
              Clear all
            </button>
          )}
        </div>

        {signals.length === 0 ? (
          <p className="text-gray-500 text-sm">
            No signals yet — start the scanner to begin detecting FVG setups.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-gray-500 border-b border-surface-border">
                  {['Time', 'Symbol', 'TF', 'Dir', 'Entry', 'Stop', 'Target', 'OB', 'Status'].map(h => (
                    <th key={h} className="pb-2 pr-3 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {signals.map(sig => (
                  <tr key={sig.id} className="border-b border-surface-border/40">
                    <td className="py-2 pr-3 font-mono text-gray-500">
                      {new Date(sig.timestamp).toLocaleTimeString()}
                    </td>
                    <td className="py-2 pr-3 font-mono text-gray-200">
                      {sig.instrument.replace('_', '/')}
                    </td>
                    <td className="py-2 pr-3 text-gray-400">{sig.timeframe}</td>
                    <td className="py-2 pr-3">
                      <span className={sig.direction === 'bullish' ? 'badge-bull' : 'badge-bear'}>
                        {sig.direction === 'bullish' ? '▲' : '▼'}
                      </span>
                    </td>
                    <td className="py-2 pr-3 font-mono">{sig.entry.toFixed(5)}</td>
                    <td className="py-2 pr-3 font-mono text-bear">{sig.stop.toFixed(5)}</td>
                    <td className="py-2 pr-3 font-mono text-bull">{sig.target.toFixed(5)}</td>
                    <td className="py-2 pr-3">
                      {sig.ob_protected ? <span className="text-brand">✓</span> : '—'}
                    </td>
                    <td className="py-2 capitalize text-gray-400">{sig.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function StatCard({ label, value, color }) {
  return (
    <div className="stat-card">
      <span className="stat-label">{label}</span>
      <span className={clsx('stat-value text-xl', color === 'bull' && 'text-bull', color === 'bear' && 'text-bear')}>
        {value}
      </span>
    </div>
  )
}

function Row({ label, children }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-gray-500 text-xs">{label}</span>
      {children}
    </div>
  )
}
