import React from 'react'
import { useStore } from '../store'

export default function DetailPanel() {
  const selectedId = useStore(s => s.selectedId)
  const conversations = useStore(s => s.conversations)
  const setSelected = useStore(s => s.setSelected)
  const toggleBlend = useStore(s => s.toggleBlend)
  const blendIds = useStore(s => s.blendIds)

  if (!selectedId) return null

  const chat = conversations.find(c => c.id === selectedId)
  if (!chat) return null

  const isBlend = blendIds.includes(selectedId)
  const sourceColor = chat.source === 'claude' ? '#7c3aed' : '#10a37f'
  const sourceEmoji = chat.source === 'claude' ? '🟣' : '🟢'

  return (
    <div style={{
      position: 'fixed', right: '24px', top: '50%',
      transform: 'translateY(-50%)',
      width: '320px',
      background: 'rgba(0,0,0,0.85)',
      border: '1px solid rgba(255,255,255,0.1)',
      borderRadius: '16px', padding: '24px',
      color: 'white', zIndex: 100,
      backdropFilter: 'blur(12px)'
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px' }}>
        <div style={{
          fontSize: '0.7rem', color: sourceColor,
          background: `${sourceColor}22`,
          padding: '3px 8px', borderRadius: '20px',
          textTransform: 'uppercase', letterSpacing: '0.5px'
        }}>
          {sourceEmoji} {chat.source}
        </div>
        <button
          onClick={() => setSelected(null)}
          style={{
            background: 'none', border: 'none',
            color: '#666', cursor: 'pointer', fontSize: '1.2rem'
          }}
        >✕</button>
      </div>

      {/* Title */}
      <h3 style={{
        fontSize: '1rem', fontWeight: '600',
        marginBottom: '12px', lineHeight: '1.4'
      }}>
        {chat.title}
      </h3>

      {/* Stats */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '16px' }}>
        {[
          { label: 'Messages', value: chat.num_messages },
          { label: 'Topic', value: chat.region },
          { label: 'Date', value: chat.created_at.slice(0, 10) }
        ].map(stat => (
          <div key={stat.label} style={{ flex: 1 }}>
            <div style={{ color: '#555', fontSize: '0.65rem', marginBottom: '2px' }}>
              {stat.label.toUpperCase()}
            </div>
            <div style={{ fontSize: '0.8rem', fontWeight: '500' }}>
              {stat.value}
            </div>
          </div>
        ))}
      </div>

      {/* Preview */}
      <p style={{
        color: '#888', fontSize: '0.8rem', lineHeight: '1.5',
        marginBottom: '20px',
        display: '-webkit-box',
        WebkitLineClamp: 4,
        WebkitBoxOrient: 'vertical',
        overflow: 'hidden'
      }}>
        {chat.preview}
      </p>

      {/* Actions */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {chat.source === 'claude' && (
          <a
            href={`https://claude.ai/chat/${chat.id}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'block', padding: '10px',
              background: 'rgba(124,58,237,0.2)',
              border: '1px solid rgba(124,58,237,0.4)',
              borderRadius: '8px', color: '#a78bfa',
              textDecoration: 'none', textAlign: 'center',
              fontSize: '0.85rem', fontWeight: '500'
            }}
          >
            🟣 Open in Claude →
          </a>
        )}

        <button
          onClick={() => toggleBlend(chat.id)}
          style={{
            padding: '10px',
            background: isBlend ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.05)',
            border: `1px solid ${isBlend ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.1)'}`,
            borderRadius: '8px', color: isBlend ? 'white' : '#888',
            cursor: 'pointer', fontSize: '0.85rem', fontWeight: '500'
          }}
        >
          {isBlend ? '✓ Added to Blend' : '➕ Add to Blend'}
        </button>
      </div>
    </div>
  )
}
