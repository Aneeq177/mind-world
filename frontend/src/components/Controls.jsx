import React from 'react'
import { useStore } from '../store'

export default function Controls() {
  const conversations = useStore(s => s.conversations)
  const sources = useStore(s => s.sources)
  const blendIds = useStore(s => s.blendIds)
  const filterSource = useStore(s => s.filterSource)
  const filterRegion = useStore(s => s.filterRegion)
  const setFilterSource = useStore(s => s.setFilterSource)
  const setFilterRegion = useStore(s => s.setFilterRegion)
  const clearBlend = useStore(s => s.clearBlend)

  const regions = ['all', ...new Set(conversations.map(c => c.region))]

  return (
    <>
      {/* Top bar */}
      <div style={{
        position: 'fixed', top: '0', left: '0', right: '0',
        padding: '16px 24px',
        display: 'flex', alignItems: 'center', gap: '16px',
        background: 'linear-gradient(to bottom, rgba(0,0,8,0.9), transparent)',
        zIndex: 50
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '1.2rem' }}>🌍</span>
          <span style={{ fontWeight: '700', color: 'white' }}>Mind World</span>
        </div>

        <div style={{ color: '#555', fontSize: '0.8rem' }}>
          {conversations.length} conversations
          {sources.claude > 0 && (
            <span style={{ color: '#7c3aed', marginLeft: '8px' }}>
              🟣 {sources.claude}
            </span>
          )}
          {sources.chatgpt > 0 && (
            <span style={{ color: '#10a37f', marginLeft: '8px' }}>
              🟢 {sources.chatgpt}
            </span>
          )}
        </div>

        <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px' }}>
          {['all', 'claude', 'chatgpt'].map(src => (
            <button
              key={src}
              onClick={() => setFilterSource(src)}
              style={{
                padding: '6px 14px',
                background: filterSource === src
                  ? 'rgba(255,255,255,0.15)'
                  : 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '20px', color: 'white',
                cursor: 'pointer', fontSize: '0.8rem',
                textTransform: 'capitalize'
              }}
            >
              {src === 'all' ? 'All' : src === 'claude' ? '🟣 Claude' : '🟢 ChatGPT'}
            </button>
          ))}
        </div>

        <button
          onClick={() => {
            useStore.setState({ conversations: [], phase: 'landing' })
          }}
          style={{
            padding: '6px 14px',
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: '20px', color: '#888',
            cursor: 'pointer', fontSize: '0.8rem'
          }}
        >
          ← New Upload
        </button>
      </div>

      {/* Blend bar */}
      {blendIds.length > 0 && (
        <div style={{
          position: 'fixed', bottom: '24px',
          left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(0,0,0,0.9)',
          border: '1px solid rgba(255,255,255,0.15)',
          borderRadius: '16px', padding: '16px 24px',
          display: 'flex', alignItems: 'center', gap: '16px',
          zIndex: 100, backdropFilter: 'blur(12px)'
        }}>
          <span style={{ color: '#888', fontSize: '0.85rem' }}>
            {blendIds.length} conversation{blendIds.length > 1 ? 's' : ''} selected
          </span>

          <button
            onClick={clearBlend}
            style={{
              padding: '8px 16px',
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: '8px', color: '#888',
              cursor: 'pointer', fontSize: '0.85rem'
            }}
          >
            Clear
          </button>

          <button
            style={{
              padding: '8px 20px',
              background: 'linear-gradient(135deg, #7c3aed, #5b21b6)',
              border: 'none', borderRadius: '8px',
              color: 'white', cursor: 'pointer',
              fontSize: '0.85rem', fontWeight: '600'
            }}
          >
            🔀 Blend Conversations
          </button>
        </div>
      )}

      {/* Region filter — left side */}
      <div style={{
        position: 'fixed', left: '24px', top: '50%',
        transform: 'translateY(-50%)',
        display: 'flex', flexDirection: 'column', gap: '6px',
        zIndex: 50
      }}>
        {regions.slice(0, 10).map(region => (
          <button
            key={region}
            onClick={() => setFilterRegion(region)}
            style={{
              padding: '6px 12px',
              background: filterRegion === region
                ? 'rgba(255,255,255,0.15)'
                : 'rgba(0,0,0,0.6)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: '20px', color: filterRegion === region ? 'white' : '#666',
              cursor: 'pointer', fontSize: '0.75rem',
              whiteSpace: 'nowrap', textAlign: 'left',
              backdropFilter: 'blur(8px)'
            }}
          >
            {region === 'all' ? '✦ All Topics' : region}
          </button>
        ))}
      </div>
    </>
  )
}
