import { NavLink, Outlet } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { getHealth } from '../api/client'
import clsx from 'clsx'

const NAV = [
  { to: '/',         label: 'Dashboard',  icon: GridIcon },
  { to: '/chart',    label: 'Chart',      icon: ChartIcon },
  { to: '/backtest', label: 'Backtest',   icon: TestIcon },
  { to: '/orb',      label: 'ORB-FVG',   icon: ORBIcon },
  { to: '/bb-rsi',   label: 'BB+RSI',    icon: BBRSIIcon },
  { to: '/config',   label: 'Strategy',   icon: SlidersIcon },
]

export default function Layout() {
  const [status, setStatus] = useState(null)

  useEffect(() => {
    getHealth()
      .then(d => setStatus(d))
      .catch(() => setStatus(null))
    const t = setInterval(() =>
      getHealth().then(setStatus).catch(() => setStatus(null)), 30000)
    return () => clearInterval(t)
  }, [])

  const isLive = status?.environment === 'live'

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <aside className="w-56 flex-shrink-0 bg-surface-card border-r border-surface-border flex flex-col">
        {/* Logo */}
        <div className="px-5 py-4 border-b border-surface-border">
          <div className="flex items-center gap-2">
            <span className="text-xl">📈</span>
            <span className="font-semibold text-white">FVG Trader</span>
          </div>
          {status && (
            <div className={clsx(
              'mt-2 text-xs px-2 py-1 rounded flex items-center gap-1.5 w-fit',
              isLive ? 'bg-bear/20 text-bear' : 'bg-bull/20 text-bull'
            )}>
              <span className={clsx(
                'w-1.5 h-1.5 rounded-full',
                isLive ? 'bg-bear' : 'bg-bull'
              )} />
              {isLive ? '⚠ LIVE' : 'DEMO'}
            </div>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 flex flex-col gap-1">
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                clsx(
                  'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-brand/20 text-brand'
                    : 'text-gray-400 hover:bg-surface-hover hover:text-gray-200'
                )
              }
            >
              <Icon className="w-4 h-4" />
              {label}
            </NavLink>
          ))}
        </nav>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-surface-border">
          <p className="text-xs text-gray-500">
            {status ? (
              <span className="text-bull">● Connected</span>
            ) : (
              <span className="text-gray-500">○ No backend</span>
            )}
          </p>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  )
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function GridIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  )
}

function ChartIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  )
}

function TestIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2V9M9 21H5a2 2 0 0 1-2-2V9m0 0h18" />
    </svg>
  )
}

function ORBIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <rect x="3" y="10" width="18" height="1.5" rx="0.75" fill="currentColor" stroke="none" />
      <rect x="3" y="13.5" width="18" height="1.5" rx="0.75" fill="currentColor" stroke="none" />
      <path d="M8 7 L12 3 L16 7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8 17 L12 21 L16 17" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function BBRSIIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      {/* Bollinger bands — outer curves */}
      <path d="M3 12 Q6 5 12 5 Q18 5 21 12" strokeLinecap="round" />
      <path d="M3 12 Q6 19 12 19 Q18 19 21 12" strokeLinecap="round" />
      {/* Middle SMA line */}
      <line x1="3" y1="12" x2="21" y2="12" strokeDasharray="2 2" />
      {/* RSI dot at oversold bounce */}
      <circle cx="7" cy="17" r="2" fill="currentColor" stroke="none" />
    </svg>
  )
}

function SlidersIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <line x1="4" y1="6" x2="20" y2="6" /><line x1="4" y1="12" x2="20" y2="12" />
      <line x1="4" y1="18" x2="20" y2="18" />
      <circle cx="8" cy="6" r="2" fill="currentColor" stroke="none" />
      <circle cx="16" cy="12" r="2" fill="currentColor" stroke="none" />
      <circle cx="10" cy="18" r="2" fill="currentColor" stroke="none" />
    </svg>
  )
}
