import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { useStore } from './store'
import Landing from './components/Landing'
import MapView from './components/MapView'
import Privacy from './components/Privacy'
import Terms from './components/Terms'

function MainApp() {
  const phase = useStore(s => s.phase)
  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative' }}>
      {(phase === 'landing' || phase === 'processing') && <Landing />}
      {phase === 'map' && <MapView />}
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<MainApp />} />
        <Route path="/privacy" element={<Privacy />} />
        <Route path="/terms" element={<Terms />} />
      </Routes>
    </BrowserRouter>
  )
}
