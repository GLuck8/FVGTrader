import axios from 'axios'

const BASE = import.meta.env.VITE_API_URL || ''

const api = axios.create({
  baseURL: `${BASE}/api/v1`,
  timeout: 30000,
})

// ── Health ──────────────────────────────────────────────────────────────────

export const getHealth = () => api.get('/health').then(r => r.data)

// ── Instruments ─────────────────────────────────────────────────────────────

export const getInstruments = () => api.get('/instruments').then(r => r.data.instruments)

// ── Account ─────────────────────────────────────────────────────────────────

export const getAccount    = () => api.get('/account').then(r => r.data)
export const getPositions  = () => api.get('/account/positions').then(r => r.data)
export const getOpenOrders = () => api.get('/account/orders').then(r => r.data)

// ── Market data ─────────────────────────────────────────────────────────────

export const getCandles = (instrument, granularity = 'H1', count = 300) =>
  api.get(`/candles/${instrument}`, { params: { granularity, count } }).then(r => r.data)

export const getPrice = (instrument) =>
  api.get(`/price/${instrument}`).then(r => r.data)

// ── FVG Analysis ─────────────────────────────────────────────────────────────

export const analyzeInstrument = (instrument, granularity, count, params) =>
  api.post(`/analyze/${instrument}`, params, { params: { granularity, count } }).then(r => r.data)

// ── Backtest ─────────────────────────────────────────────────────────────────

export const runBacktest = (body) =>
  api.post('/backtest', body).then(r => r.data)

// ── Orders ───────────────────────────────────────────────────────────────────

export const placeOrder   = (body)     => api.post('/orders', body).then(r => r.data)
export const cancelOrder  = (orderId)  => api.delete(`/orders/${orderId}`).then(r => r.data)
export const closePosition = (instrument) => api.delete(`/positions/${instrument}`).then(r => r.data)

// ── Scanner ──────────────────────────────────────────────────────────────────

export const getScannerConfig  = ()       => api.get('/scanner/config').then(r => r.data)
export const setScannerConfig  = (config) => api.put('/scanner/config', config).then(r => r.data)
export const getScannerSignals = (limit = 50) =>
  api.get('/scanner/signals', { params: { limit } }).then(r => r.data)
export const clearSignals      = ()       => api.delete('/scanner/signals').then(r => r.data)
export const getScannerStatus  = ()       => api.get('/scanner/status').then(r => r.data)

// ── ORB-FVG Strategy ─────────────────────────────────────────────────────────

export const getORBAnalysis = (instrument, params = {}) =>
  api.get(`/orb/analyze/${instrument}`, { params }).then(r => r.data)

export const runORBBacktest = (body) =>
  api.post('/orb/backtest', body, { timeout: 60000 }).then(r => r.data)

// ── BB+RSI Strategy ──────────────────────────────────────────────────────────

export const getBBRSISignals = (instrument, granularity = 'H1', count = 300, params = {}) =>
  api.get(`/bb-rsi/signals/${instrument}`, { params: { granularity, count, ...params } }).then(r => r.data)

export const runBBRSIBacktest = (body) =>
  api.post('/bb-rsi/backtest', body, { timeout: 60000 }).then(r => r.data)
