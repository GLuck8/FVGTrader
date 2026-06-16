import { Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import ChartView from './pages/ChartView'
import Backtest from './pages/Backtest'
import Config from './pages/Config'

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index    element={<Dashboard />} />
        <Route path="chart"    element={<ChartView />} />
        <Route path="backtest" element={<Backtest />} />
        <Route path="config"   element={<Config />} />
      </Route>
    </Routes>
  )
}
