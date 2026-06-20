import { useEffect } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { useStore } from './store'
import Landing from './components/Landing'
import MapView from './components/MapView'
import Privacy from './components/Privacy'
import Terms from './components/Terms'
import AuthCallback from './components/AuthCallback'

function MainApp() {
  const phase = useStore(s => s.phase)

  useEffect(() => {
    const lockScroll = phase === 'map'
    document.body.style.overflow = lockScroll ? 'hidden' : ''
    document.documentElement.style.overflow = lockScroll ? 'hidden' : ''
    return () => {
      document.body.style.overflow = ''
      document.documentElement.style.overflow = ''
    }
  }, [phase])

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
        <Route path="/auth/callback" element={<AuthCallback />} />
        <Route path="/privacy" element={<Privacy />} />
        <Route path="/terms" element={<Terms />} />
      </Routes>
    </BrowserRouter>
  )
}
