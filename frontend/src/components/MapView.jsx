import { useMemo, useState } from 'react'
import { useStore } from '../store'
import MapPlot from './MapPlot'
import BlenderPanel from './BlenderPanel'
import ConvoList from './ConvoList'
import TimeMachine from './TimeMachine'
import DetailPanel from './DetailPanel'

const BORDER = '1px solid rgba(255,255,255,0.07)'
const PANEL_BG = 'rgba(8,8,18,0.96)'

export default function MapView() {
  const conversations  = useStore(s => s.conversations)
  const email          = useStore(s => s.email)
  const selectedId     = useStore(s => s.selectedId)
  const blendIds       = useStore(s => s.blendIds)
  const filterSource   = useStore(s => s.filterSource)
  const filterRegion   = useStore(s => s.filterRegion)
  const setPhase       = useStore(s => s.setPhase)
  const setSelected    = useStore(s => s.setSelected)
  const toggleBlend    = useStore(s => s.toggleBlend)
  const clearBlend     = useStore(s => s.clearBlend)
  const setFilterSource = useStore(s => s.setFilterSource)
  const setFilterRegion = useStore(s => s.setFilterRegion)

  const [sortBy, setSortBy] = useState('recent')

  // Derived totals
  const totalMessages = conversations.reduce((a, c) => a + (c.num_messages || 0), 0)
  const claudeCount   = conversations.filter(c => c.source === 'claude').length
  const chatgptCount  = conversations.filter(c => c.source === 'chatgpt').length

  const regions = useMemo(() => {
    const set = new Set(conversations.map(c => c.region).filter(Boolean))
    return Array.from(set).sort()
  }, [conversations])

  const filtered = useMemo(() => conversations.filter(c => {
    if (filterSource !== 'all' && c.source !== filterSource) return false
    if (filterRegion !== 'all' && c.region !== filterRegion) return false
    return true
  }), [conversations, filterSource, filterRegion])

  const selectedConvo = useMemo(() => (
    selectedId ? conversations.find(c => c.id === selectedId) || null : null
  ), [conversations, selectedId])

  function handleSelect(id) {
    setSelected(id === selectedId ? null : id)
  }

  // Pill button for platform filter
  function PillBtn({ label, value }) {
    const active = filterSource === value
    return (
      <button
        onClick={() => setFilterSource(value)}
        style={{
          padding: '4px 12px',
          background: active ? 'rgba(124,58,237,0.28)' : 'rgba(255,255,255,0.04)',
          border: `1px solid ${active ? 'rgba(124,58,237,0.55)' : 'rgba(255,255,255,0.08)'}`,
          borderRadius: '6px',
          color: active ? '#a78bfa' : '#666',
          fontSize: '0.75rem',
          fontWeight: active ? '600' : '400',
          cursor: 'pointer',
          transition: 'all 0.12s',
        }}
      >
        {label}
      </button>
    )
  }

  return (
    <div style={{
      width: '100vw',
      height: '100vh',
      background: '#0a0a0f',
      color: 'white',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    }}>

      {/* ── Header ── */}
      <div style={{
        height: '52px',
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        gap: '16px',
        padding: '0 14px',
        borderBottom: BORDER,
        background: 'rgba(8,8,18,0.92)',
        backdropFilter: 'blur(8px)',
      }}>
        {/* Logo + stats */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexShrink: 0 }}>
          <div style={{ fontWeight: '700', fontSize: '0.95rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span>🌍</span><span>Mind World</span>
          </div>
          <div style={{ display: 'flex', gap: '12px', fontSize: '0.72rem', color: '#555' }}>
            <span><b style={{ color: 'white' }}>{conversations.length}</b> conversations</span>
            <span><b style={{ color: 'white' }}>{totalMessages.toLocaleString()}</b> messages</span>
            <span><b style={{ color: '#a78bfa' }}>{claudeCount}</b> claude</span>
            <span><b style={{ color: '#34d399' }}>{chatgptCount}</b> chatgpt</span>
          </div>
        </div>

        {/* Filters — centered */}
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <PillBtn label="All" value="all" />
          <PillBtn label="Claude" value="claude" />
          <PillBtn label="ChatGPT" value="chatgpt" />

          <select
            value={filterRegion}
            onChange={e => setFilterRegion(e.target.value)}
            style={{
              padding: '4px 10px',
              background: 'rgba(255,255,255,0.04)',
              border: `1px solid ${filterRegion !== 'all' ? 'rgba(124,58,237,0.5)' : 'rgba(255,255,255,0.08)'}`,
              borderRadius: '6px',
              color: filterRegion !== 'all' ? '#a78bfa' : '#666',
              fontSize: '0.75rem',
              outline: 'none',
              cursor: 'pointer',
            }}
          >
            <option value="all">All Topics</option>
            {regions.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>

        {/* New upload */}
        <button
          onClick={() => {
            setSelected(null)
            clearBlend()
            setFilterSource('all')
            setFilterRegion('all')
            setPhase('landing')
          }}
          style={{
            padding: '5px 14px',
            background: 'none',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: '7px',
            color: '#555',
            fontSize: '0.75rem',
            cursor: 'pointer',
            flexShrink: 0,
            transition: 'all 0.15s',
          }}
        >
          ← New Upload
        </button>
      </div>

      {/* ── Body ── */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* Left: Blender */}
        <div style={{
          width: '272px',
          flexShrink: 0,
          borderRight: BORDER,
          background: PANEL_BG,
          overflowY: 'auto',
        }}>
          <BlenderPanel
            blendIds={blendIds}
            conversations={conversations}
            email={email}
            onRemove={id => toggleBlend(id)}
            onClear={clearBlend}
          />
        </div>

        {/* Center: Map + Time Machine (scrolls vertically) */}
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          {/* Map */}
          <div style={{ height: 'clamp(260px, 40vh, 460px)', flexShrink: 0 }}>
            <MapPlot
              conversations={filtered}
              selectedId={selectedId}
              blendIds={blendIds}
              onSelect={handleSelect}
            />
          </div>

          {/* Caption */}
          <div style={{
            padding: '6px 16px',
            fontSize: '0.68rem',
            color: '#333',
            borderTop: BORDER,
            flexShrink: 0,
          }}>
            ● Circle = Claude &nbsp;◆ Diamond = ChatGPT &nbsp;★ Star = selected for blend · Scroll to zoom · Drag to pan
          </div>

          {/* Time Machine */}
          <div style={{
            padding: '20px 20px 32px',
            borderTop: BORDER,
            background: 'rgba(5,5,15,0.6)',
          }}>
            <TimeMachine conversations={filtered} />
          </div>
        </div>

        {/* Right: ConvoList + detail overlay */}
        <div style={{
          width: '272px',
          flexShrink: 0,
          borderLeft: BORDER,
          background: PANEL_BG,
          position: 'relative',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}>
          <ConvoList
            conversations={filtered}
            selectedId={selectedId}
            blendIds={blendIds}
            sortBy={sortBy}
            onSortChange={setSortBy}
            onSelect={handleSelect}
          />

          {/* Detail panel slides over the list */}
          {selectedConvo && (
            <div style={{
              position: 'absolute',
              inset: 0,
              background: PANEL_BG,
              backdropFilter: 'blur(10px)',
              padding: '16px',
              zIndex: 10,
              overflow: 'auto',
            }}>
              <DetailPanel
                conversation={selectedConvo}
                isBlended={blendIds.includes(selectedConvo.id)}
                onClose={() => setSelected(null)}
                onToggleBlend={() => toggleBlend(selectedConvo.id)}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
