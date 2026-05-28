import { useMemo, useState } from 'react'
import { useStore } from '../store'
import MapPlot from './MapPlot'
import BlenderPanel from './BlenderPanel'
import ConvoList from './ConvoList'
import TimeMachine from './TimeMachine'
import DetailPanel from './DetailPanel'

const BORDER = '1px solid rgba(255,255,255,0.07)'
const PANEL_BG = 'rgba(8,8,18,0.96)'
const SIDEBAR_BG = 'rgba(10, 10, 20, 0.92)'

export default function MapView() {
  const conversations   = useStore(s => s.conversations)
  const email           = useStore(s => s.email)
  const selectedId      = useStore(s => s.selectedId)
  const blendIds        = useStore(s => s.blendIds)
  const filterSource    = useStore(s => s.filterSource)
  const filterRegion    = useStore(s => s.filterRegion)
  const setPhase        = useStore(s => s.setPhase)
  const setSelected     = useStore(s => s.setSelected)
  const toggleBlend     = useStore(s => s.toggleBlend)
  const clearBlend      = useStore(s => s.clearBlend)
  const setFilterSource = useStore(s => s.setFilterSource)
  const setFilterRegion = useStore(s => s.setFilterRegion)

  const [sortBy, setSortBy] = useState('recent')
  const [leftOpen, setLeftOpen] = useState(false)
  const [rightOpen, setRightOpen] = useState(false)

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

  const regionColors = useMemo(() => {
    const map = {}
    for (const c of filtered) {
      if (c.region && !map[c.region]) map[c.region] = c.color || '#666666'
    }
    return map
  }, [filtered])

  const selectedConvo = useMemo(() => (
    selectedId ? conversations.find(c => c.id === selectedId) || null : null
  ), [conversations, selectedId])

  function handleSelect(id) {
    setSelected(id === selectedId ? null : id)
  }

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

  const toggleBtnBase = {
    position: 'fixed',
    zIndex: 101,
    background: 'rgba(124, 58, 237, 0.8)',
    border: 'none',
    color: 'white',
    padding: '16px 8px',
    cursor: 'pointer',
    fontSize: '14px',
    backdropFilter: 'blur(8px)',
  }

  return (
    <div style={{
      position: 'relative',
      width: '100vw',
      height: '100vh',
      background: '#0a0a0f',
      color: 'white',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      overflow: 'hidden',
    }}>

      {/* ── Map: fills between top bar and bottom bar ── */}
      <div style={{ position: 'absolute', top: '48px', left: 0, right: 0, bottom: '180px' }}>
        <MapPlot
          conversations={filtered}
          selectedId={selectedId}
          blendIds={blendIds}
          onSelect={handleSelect}
        />
      </div>

      {/* ── Legend overlay (bottom-left of map) ── */}
      {Object.keys(regionColors).length > 0 && (
        <div style={{
          position: 'fixed',
          bottom: 190,
          left: 16,
          background: 'rgba(8, 8, 18, 0.85)',
          backdropFilter: 'blur(8px)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: '8px',
          padding: '8px 12px',
          zIndex: 50,
          maxHeight: '200px',
          overflowY: 'auto',
        }}>
          {Object.entries(regionColors).map(([region, color]) => (
            <div key={region} style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px', fontSize: '0.7rem', color: '#aaa' }}>
              <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: color, flexShrink: 0 }} />
              {region}
            </div>
          ))}
        </div>
      )}

      {/* ── Left sidebar overlay (Context Blender + Time Machine) ── */}
      <div style={{
        position: 'fixed',
        left: 0,
        top: '48px',
        bottom: 0,
        width: '320px',
        zIndex: 100,
        transform: leftOpen ? 'translateX(0)' : 'translateX(-100%)',
        transition: 'transform 0.25s ease',
        background: 'rgba(8, 8, 18, 0.95)',
        backdropFilter: 'blur(16px)',
        borderRight: '1px solid rgba(255,255,255,0.08)',
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
      }}>
        <BlenderPanel
          blendIds={blendIds}
          conversations={conversations}
          email={email}
          onRemove={id => toggleBlend(id)}
          onClear={clearBlend}
        />
      </div>

      {/* ── Left toggle button ── */}
      <button
        onClick={() => setLeftOpen(o => !o)}
        style={{
          ...toggleBtnBase,
          left: leftOpen ? '320px' : '0px',
          top: '50%',
          transform: 'translateY(-50%)',
          borderRadius: '0 8px 8px 0',
          transition: 'left 0.25s ease',
        }}
      >
        {leftOpen ? '◀' : '▶'}
      </button>

      {/* ── Right sidebar overlay (Conversation List + Detail Panel) ── */}
      <div style={{
        position: 'fixed',
        right: 0,
        top: '48px',
        bottom: 0,
        width: '320px',
        zIndex: 100,
        transform: rightOpen ? 'translateX(0)' : 'translateX(100%)',
        transition: 'transform 0.25s ease',
        background: 'rgba(8, 8, 18, 0.95)',
        backdropFilter: 'blur(16px)',
        borderLeft: '1px solid rgba(255,255,255,0.08)',
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

      {/* ── Right toggle button ── */}
      <button
        onClick={() => setRightOpen(o => !o)}
        style={{
          ...toggleBtnBase,
          right: rightOpen ? '320px' : '0px',
          top: '50%',
          transform: 'translateY(-50%)',
          borderRadius: '8px 0 0 8px',
          transition: 'right 0.25s ease',
        }}
      >
        {rightOpen ? '▶' : '◀'}
      </button>

      {/* ── Top controls bar (always on top) ── */}
      <div style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        height: '48px',
        zIndex: 200,
        display: 'flex',
        alignItems: 'center',
        gap: '16px',
        padding: '0 16px',
        borderBottom: '1px solid rgba(255,255,255,0.08)',
        background: 'rgba(8, 8, 18, 0.95)',
        backdropFilter: 'blur(12px)',
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

      {/* ── Time Machine bottom bar ── */}
      <div style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        height: 'auto',
        maxHeight: '180px',
        background: 'rgba(8, 8, 18, 0.92)',
        backdropFilter: 'blur(12px)',
        borderTop: '1px solid rgba(255,255,255,0.08)',
        padding: '12px 24px',
        zIndex: 50,
        overflowY: 'auto',
      }}>
        <TimeMachine conversations={filtered} />
      </div>
    </div>
  )
}
