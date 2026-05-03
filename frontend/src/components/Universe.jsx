import React, { useMemo } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, Stars } from '@react-three/drei'
import { useStore } from '../store'
import ConversationOrb from './ConversationOrb'

function StarField() {
  return <Stars radius={800} depth={100} count={5000} factor={4} fade />
}

function Scene() {
  const conversations = useStore(s => s.conversations)
  const filterSource = useStore(s => s.filterSource)
  const filterRegion = useStore(s => s.filterRegion)

  const filtered = useMemo(() => {
    return conversations.filter(c => {
      if (filterSource !== 'all' && c.source !== filterSource) return false
      if (filterRegion !== 'all' && c.region !== filterRegion) return false
      return true
    })
  }, [conversations, filterSource, filterRegion])

  return (
    <>
      <ambientLight intensity={0.3} />
      <pointLight position={[0, 0, 0]} intensity={2} color="#7c3aed" />
      <pointLight position={[200, 200, 200]} intensity={1} color="#10a37f" />
      <StarField />
      {filtered.map(chat => (
        <ConversationOrb key={chat.id} chat={chat} />
      ))}
    </>
  )
}

export default function Universe() {
  return (
    <div style={{
      width: '100vw', height: '100vh',
      position: 'absolute', top: 0, left: 0
    }}>
      <Canvas
        camera={{ position: [0, 0, 800], fov: 60, near: 1, far: 5000 }}
        gl={{ antialias: true, alpha: false }}
        style={{ background: '#000008' }}
      >
        <Scene />
        <OrbitControls
          enablePan={true}
          enableZoom={true}
          enableRotate={true}
          zoomSpeed={0.8}
          rotateSpeed={0.5}
          minDistance={50}
          maxDistance={2000}
        />
      </Canvas>
    </div>
  )
}
