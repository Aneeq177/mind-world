import React from 'react'
import { useStore } from './store'
import Landing from './components/Landing'
import Universe from './components/Universe'
import DetailPanel from './components/DetailPanel'
import Controls from './components/Controls'

export default function App() {
  const phase = useStore(s => s.phase)

  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative' }}>
      {phase === 'landing' && <Landing />}

      {(phase === 'processing' || phase === 'universe') && (
        <>
          <Universe />
          <Controls />
          <DetailPanel />
        </>
      )}
    </div>
  )
}
