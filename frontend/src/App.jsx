import { useStore } from './store'
import Landing from './components/Landing'
import MapView from './components/MapView'

export default function App() {
  const phase = useStore(s => s.phase)

  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative' }}>
      {(phase === 'landing' || phase === 'processing') && <Landing />}
      {phase === 'map' && <MapView />}
    </div>
  )
}
