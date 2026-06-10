import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store'
import { searchConversations } from '../api'
import MapPlot from './MapPlot'
import BlenderPanel from './BlenderPanel'
import ConvoList from './ConvoList'
import DetailPanel from './DetailPanel'

const PANEL_BG = 'rgba(8,8,18,0.96)'

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)')
    const handler = (e) => setIsMobile(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])
  return isMobile
}

function buildMonths(conversations) {
  const dates = conversations.flatMap(c => {
    try {
      const d = new Date(c.created_at)
      return isNaN(d.getTime()) ? [] : [d.getTime()]
    } catch { return [] }
  })
  if (!dates.length) return []

  const minD = new Date(Math.min(...dates))
  const maxD = new Date(Math.max(...dates))
  const months = []
  let cur = new Date(minD.getFullYear(), minD.getMonth(), 1)
  const end = new Date(maxD.getFullYear(), maxD.getMonth(), 1)
  while (cur <= end) {
    months.push(new Date(cur))
    cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1)
  }
  return months
}

function fmt(d) {
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
}

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
  
  const isMobile = useIsMobile()

  const [sortBy, setSortBy] = useState('recent')
  const [leftOpen, setLeftOpen] = useState(false)
  const [rightOpen, setRightOpen] = useState(false)
  const [timeIdx, setTimeIdx] = useState(Number.MAX_SAFE_INTEGER)
  // MW-006: Semantic search
  const [searchQuery, setSearchQuery] = useState('')
  const [searchMatchIds, setSearchMatchIds] = useState(new Set())
  const [isSearching, setIsSearching] = useState(false)
  const searchTimerRef = useRef(null)

  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    const q = searchQuery.trim()
    if (!q || q.length < 3) {
      setSearchMatchIds(new Set())
      return
    }
    searchTimerRef.current = setTimeout(async () => {
      try {
        setIsSearching(true)
        const data = await searchConversations({ email, query: q })
        setSearchMatchIds(new Set((data.results || []).map(r => r.id)))
      } catch {
        setSearchMatchIds(new Set())
      } finally {
        setIsSearching(false)
      }
    }, 600)
    return () => clearTimeout(searchTimerRef.current)
  }, [searchQuery, email])

  // MW-003: close other panel when opening one on mobile
  function handleToggleLeft() {
    if (isMobile && !leftOpen) setRightOpen(false)
    setLeftOpen(o => !o)
  }
  function handleToggleRight() {
    if (isMobile && !rightOpen) setLeftOpen(false)
    setRightOpen(o => !o)
  }

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

  const months = useMemo(() => buildMonths(filtered), [filtered])

  const safeIdx = Math.min(timeIdx, Math.max(0, months.length - 1))
  const isAtMax = months.length === 0 || safeIdx === months.length - 1

  const { timeFiltered, newThisMonth } = useMemo(() => {
    if (!months.length || safeIdx === months.length - 1) {
      return { timeFiltered: filtered, newThisMonth: [] }
    }
    const cutoff = months[safeIdx]
    const cutoffEnd = new Date(cutoff.getFullYear(), cutoff.getMonth() + 1, 1)
    const timeFiltered = filtered.filter(c => {
      try { return new Date(c.created_at) < cutoffEnd } catch { return false }
    })
    const newThisMonth = timeFiltered.filter(c => {
      try {
        const d = new Date(c.created_at)
        return d >= cutoff && d < cutoffEnd
      } catch { return false }
    })
    return { timeFiltered, newThisMonth }
  }, [filtered, months, safeIdx])

  const newIds = useMemo(() => new Set(newThisMonth.map(c => c.id)), [newThisMonth])

  const displayCount  = timeFiltered.length
  const newCount      = newThisMonth.length
  const totalMsgCount = timeFiltered.reduce((a, c) => a + (c.num_messages || 0), 0)

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

  // ── Sidebar styles: desktop = fixed side panels; mobile = bottom sheets ──
  const sidebarBase = isMobile
    ? {
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: '52px',
        height: '62vh',
        zIndex: 100,
        background: 'rgba(8, 8, 18, 0.97)',
        backdropFilter: 'blur(16px)',
        borderTop: '1px solid rgba(255,255,255,0.1)',
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
      }
    : {
        position: 'fixed',
        top: '48px',
        bottom: '52px',
        width: '320px',
        zIndex: 100,
        background: 'rgba(8, 8, 18, 0.95)',
        backdropFilter: 'blur(16px)',
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
      }

  const leftSidebarStyle = {
    ...sidebarBase,
    ...(isMobile
      ? { transform: leftOpen ? 'translateY(0)' : 'translateY(110%)', transition: 'transform 0.28s ease' }
      : { left: 0, borderRight: '1px solid rgba(255,255,255,0.08)', transform: leftOpen ? 'translateX(0)' : 'translateX(-100%)', transition: 'transform 0.25s ease' }
    ),
  }

  const rightSidebarStyle = {
    ...sidebarBase,
    ...(isMobile
      ? { transform: rightOpen ? 'translateY(0)' : 'translateY(110%)', transition: 'transform 0.28s ease' }
      : { right: 0, borderLeft: '1px solid rgba(255,255,255,0.08)', transform: rightOpen ? 'translateX(0)' : 'translateX(100%)', transition: 'transform 0.25s ease' }
    ),
  }

  // ── Toggle button styles ──
  const toggleBtnBase = isMobile
    ? {
        position: 'fixed',
        zIndex: 101,
        background: 'rgba(124, 58, 237, 0.85)',
        border: 'none',
        color: 'white',
        padding: '8px 14px',
        cursor: 'pointer',
        fontSize: '12px',
        backdropFilter: 'blur(8px)',
        bottom: '52px',
        borderRadius: '8px 8px 0 0',
      }
    : {
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

      {/* ── Map: fills between top bar and time machine bar ── */}
      <div style={{ position: 'fixed', top: '48px', left: 0, right: 0, bottom: '52px', overflow: 'hidden' }}>
        <MapPlot
          conversations={timeFiltered}
          newIds={newIds}
          selectedId={selectedId}
          blendIds={blendIds}
          searchMatchIds={searchMatchIds}
          onSelect={handleSelect}
        />
      </div>

      {/* ── Legend overlay (desktop only, above time bar) ── */}
      {!isMobile && Object.keys(regionColors).length > 0 && (
        <div style={{
          position: 'fixed',
          bottom: 62,
          left: 16,
          background: 'rgba(8, 8, 18, 0.85)',
          backdropFilter: 'blur(8px)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: '8px',
          padding: '8px 12px',
          zIndex: 49,
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

      {/* ── Left sidebar overlay (Context Blender) ── */}
      <div style={leftSidebarStyle}>
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
        onClick={handleToggleLeft}
        style={isMobile
          ? { ...toggleBtnBase, left: '12px' }
          : {
              ...toggleBtnBase,
              left: leftOpen ? '320px' : '0px',
              top: '50%',
              transform: 'translateY(-50%)',
              borderRadius: '0 8px 8px 0',
              transition: 'left 0.25s ease',
            }
        }
      >
        {isMobile ? (leftOpen ? '✕ Blender' : '⚗ Blender') : (leftOpen ? '◀' : '▶')}
      </button>

      {/* ── Right sidebar overlay (Conversation List + Detail Panel) ── */}
      <div style={rightSidebarStyle}>
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
        onClick={handleToggleRight}
        style={isMobile
          ? { ...toggleBtnBase, right: '12px' }
          : {
              ...toggleBtnBase,
              right: rightOpen ? '320px' : '0px',
              top: '50%',
              transform: 'translateY(-50%)',
              borderRadius: '8px 0 0 8px',
              transition: 'right 0.25s ease',
            }
        }
      >
        {isMobile ? (rightOpen ? '✕ Convos' : '☰ Convos') : (rightOpen ? '▶' : '◀')}
      </button>

      {/* ── Top controls bar ── */}
      <div style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        height: '48px',
        zIndex: 200,
        display: 'flex',
        alignItems: 'center',
        gap: isMobile ? '8px' : '16px',
        padding: '0 12px',
        borderBottom: '1px solid rgba(255,255,255,0.08)',
        background: 'rgba(8, 8, 18, 0.95)',
        backdropFilter: 'blur(12px)',
        minWidth: 0,
      }}>
        {/* Logo */}
        <div style={{ fontWeight: '700', fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '5px', flexShrink: 0 }}>
          <span>🌍</span>
          {!isMobile && <span>Mind World</span>}
        </div>

        {/* Stats — hidden on mobile */}
        {!isMobile && (
          <div style={{ display: 'flex', gap: '12px', fontSize: '0.72rem', color: '#555', flexShrink: 0 }}>
            <span><b style={{ color: 'white' }}>{conversations.length}</b> convos</span>
            <span><b style={{ color: 'white' }}>{totalMessages.toLocaleString()}</b> msgs</span>
            <span><b style={{ color: '#a78bfa' }}>{claudeCount}</b> claude</span>
            <span><b style={{ color: '#34d399' }}>{chatgptCount}</b> chatgpt</span>
          </div>
        )}

        {/* MW-006: Semantic search input */}
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
          <div style={{ position: 'relative', flex: isMobile ? 1 : '0 1 220px', minWidth: 0 }}>
            <input
              type="text"
              placeholder={isSearching ? 'Searching…' : '🔍 Search your memory…'}
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              style={{
                width: '100%',
                padding: '5px 28px 5px 10px',
                background: searchMatchIds.size > 0
                  ? 'rgba(124,58,237,0.18)'
                  : 'rgba(255,255,255,0.05)',
                border: `1px solid ${searchMatchIds.size > 0
                  ? 'rgba(124,58,237,0.5)'
                  : 'rgba(255,255,255,0.1)'}`,
                borderRadius: '6px',
                color: 'white',
                fontSize: '0.75rem',
                outline: 'none',
                boxSizing: 'border-box',
                transition: 'border-color 0.15s, background 0.15s',
              }}
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                style={{
                  position: 'absolute',
                  right: '6px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none',
                  border: 'none',
                  color: '#666',
                  cursor: 'pointer',
                  fontSize: '12px',
                  padding: '0',
                  lineHeight: 1,
                }}
              >
                ✕
              </button>
            )}
          </div>

          {/* Filter pills — hidden on mobile */}
          {!isMobile && (
            <>
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
            </>
          )}
        </div>

        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={() => {
              setSelected(null)
              clearBlend()
              setFilterSource('all')
              setFilterRegion('all')
              setSearchQuery('')
              setViewportTab('all')
              setPhase('landing')
            }}
            style={{
              padding: isMobile ? '5px 8px' : '5px 14px',
              background: 'none',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: '7px',
              color: '#555',
              fontSize: isMobile ? '0.7rem' : '0.75rem',
              cursor: 'pointer',
              flexShrink: 0,
              transition: 'all 0.15s',
              whiteSpace: 'nowrap',
            }}
          >
            {isMobile ? '↩' : '← New Upload'}
          </button>
        </div>
      </div>

      {/* ── Search result count badge ── */}
      {searchMatchIds.size > 0 && (
        <div style={{
          position: 'fixed',
          top: '56px',
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 199,
          background: 'rgba(124,58,237,0.9)',
          backdropFilter: 'blur(8px)',
          borderRadius: '20px',
          padding: '3px 12px',
          fontSize: '0.72rem',
          color: 'white',
          pointerEvents: 'none',
        }}>
          {searchMatchIds.size} match{searchMatchIds.size !== 1 ? 'es' : ''} highlighted
        </div>
      )}

      {/* ── Time Machine bottom bar ── */}
      {months.length > 0 && (
        <div style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          height: '52px',
          zIndex: 50,
          background: 'rgba(8, 8, 18, 0.95)',
          backdropFilter: 'blur(12px)',
          borderTop: '1px solid rgba(255,255,255,0.08)',
          padding: '0 12px',
          display: 'flex',
          alignItems: 'center',
          gap: isMobile ? '8px' : '16px',
        }}>
          <span style={{ fontSize: '0.85rem', flexShrink: 0 }}>⏳</span>
          {!isMobile && (
            <span style={{ fontSize: '0.72rem', color: '#555', flexShrink: 0, whiteSpace: 'nowrap' }}>
              {fmt(months[0])} →{' '}
              <span style={{ color: isAtMax ? '#555' : '#a78bfa' }}>{fmt(months[safeIdx])}</span>
            </span>
          )}
          <input
            type="range"
            min={0}
            max={months.length - 1}
            value={safeIdx}
            onChange={e => setTimeIdx(Number(e.target.value))}
            style={{ flex: 1, accentColor: '#7c3aed', cursor: 'pointer' }}
          />
          <span style={{ fontSize: '0.72rem', color: '#555', flexShrink: 0, whiteSpace: 'nowrap' }}>
            <b style={{ color: 'white' }}>{displayCount}</b>
            {!isMobile && ' conversations'}
            {!isAtMax && <> · <b style={{ color: '#a78bfa' }}>{newCount}</b>{!isMobile && ' new'}</>}
            {!isMobile && <> · <b style={{ color: 'white' }}>{totalMsgCount.toLocaleString()}</b>{' messages'}</>}
          </span>
          {!isAtMax && (
            <button
              onClick={() => setTimeIdx(Number.MAX_SAFE_INTEGER)}
              style={{
                background: 'none',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '4px',
                color: '#888',
                fontSize: '0.7rem',
                padding: '2px 6px',
                cursor: 'pointer',
                flexShrink: 0,
              }}
            >
              ✕
            </button>
          )}
        </div>
      )}

    </div>
  )
}
