import React, { useRef, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import * as THREE from 'three'
import { useStore } from '../store'

export default function ConversationOrb({ chat }) {
  const meshRef = useRef()
  const setSelected = useStore(s => s.setSelected)
  const setHovered = useStore(s => s.setHovered)
  const selectedId = useStore(s => s.selectedId)
  const hoveredId = useStore(s => s.hoveredId)
  const blendIds = useStore(s => s.blendIds)

  const isSelected = selectedId === chat.id
  const isHovered = hoveredId === chat.id
  const isBlend = blendIds.includes(chat.id)

  const baseSize = Math.max(3, Math.min(12, chat.num_messages / 4))

  const color = useMemo(() => new THREE.Color(chat.color), [chat.color])

  const geometry = useMemo(() => {
    if (chat.source === 'chatgpt') {
      return new THREE.OctahedronGeometry(baseSize, 0)
    }
    return new THREE.SphereGeometry(baseSize, 16, 16)
  }, [chat.source, baseSize])

  useFrame((state) => {
    if (!meshRef.current) return
    const t = state.clock.elapsedTime

    meshRef.current.position.y = chat.y + Math.sin(t * 0.5 + chat.x * 0.01) * 3

    const scale = isSelected ? 1.5 : isHovered ? 1.25 : isBlend ? 1.3 : 1
    meshRef.current.scale.lerp(
      new THREE.Vector3(scale, scale, scale), 0.1
    )
  })

  return (
    <group position={[chat.x, chat.y, chat.z]}>
      <mesh
        ref={meshRef}
        geometry={geometry}
        onClick={(e) => {
          e.stopPropagation()
          setSelected(chat.id)
        }}
        onPointerOver={(e) => {
          e.stopPropagation()
          setHovered(chat.id)
          document.body.style.cursor = 'pointer'
        }}
        onPointerOut={() => {
          setHovered(null)
          document.body.style.cursor = 'default'
        }}
      >
        <meshStandardMaterial
          color={isSelected ? '#ffffff' : color}
          emissive={color}
          emissiveIntensity={isHovered ? 0.8 : isBlend ? 0.6 : 0.3}
          roughness={0.3}
          metalness={0.1}
          transparent
          opacity={0.9}
        />
      </mesh>

      {/* Glow ring for blend selected */}
      {isBlend && (
        <mesh geometry={new THREE.RingGeometry(baseSize + 2, baseSize + 4, 32)}>
          <meshBasicMaterial color="#ffffff" transparent opacity={0.4} side={THREE.DoubleSide} />
        </mesh>
      )}

      {/* Hover tooltip */}
      {isHovered && (
        <Html distanceFactor={200} center>
          <div style={{
            background: 'rgba(0,0,0,0.85)',
            border: '1px solid rgba(255,255,255,0.15)',
            borderRadius: '8px', padding: '8px 12px',
            color: 'white', fontSize: '12px',
            whiteSpace: 'nowrap', pointerEvents: 'none',
            maxWidth: '200px'
          }}>
            <div style={{ fontWeight: '600', marginBottom: '2px' }}>
              {chat.title.slice(0, 40)}{chat.title.length > 40 ? '...' : ''}
            </div>
            <div style={{ color: '#888', fontSize: '11px' }}>
              {chat.region} · {chat.num_messages} msgs
            </div>
          </div>
        </Html>
      )}
    </group>
  )
}
