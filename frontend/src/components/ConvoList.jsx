export default function ConvoList({ conversations, selectedId, blendIds, sortBy, onSortChange, onSelect }) {
  const sorted = [...conversations].sort((a, b) => {
    if (sortBy === 'messages') return (b.num_messages || 0) - (a.num_messages || 0)
    if (sortBy === 'alpha') return a.title.localeCompare(b.title)
    // recent: descending date
    return (b.created_at || '') > (a.created_at || '') ? 1 : -1
  })

  const display = sorted.slice(0, 25)

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{
        padding: '12px 14px 10px',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        flexShrink: 0,
      }}>
        <div style={{ fontSize: '0.72rem', fontWeight: '700', color: '#888', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: '6px' }}>
          Conversations
        </div>
        <div style={{ fontSize: '0.68rem', color: '#3a3a4a', marginBottom: '8px' }}>
          {conversations.length} shown · top 25
        </div>
        <select
          value={sortBy}
          onChange={e => onSortChange(e.target.value)}
          style={{
            width: '100%',
            padding: '6px 8px',
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: '6px',
            color: '#888',
            fontSize: '0.75rem',
            outline: 'none',
            cursor: 'pointer',
          }}
        >
          <option value="recent">Most Recent</option>
          <option value="messages">Most Messages</option>
          <option value="alpha">Alphabetical</option>
        </select>
      </div>

      {/* List */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px', minHeight: 0 }}>
        {display.map(c => {
          const isSelected = c.id === selectedId
          const isBlend = blendIds.includes(c.id)
          const emoji = c.source === 'claude' ? '🟣' : '🟢'

          return (
            <div
              key={c.id}
              onClick={() => onSelect(c.id)}
              style={{
                padding: '9px 11px',
                marginBottom: '4px',
                background: isSelected
                  ? 'rgba(124,58,237,0.18)'
                  : isBlend
                    ? 'rgba(124,58,237,0.08)'
                    : 'rgba(255,255,255,0.03)',
                border: `1px solid ${isSelected
                  ? 'rgba(124,58,237,0.5)'
                  : isBlend
                    ? 'rgba(124,58,237,0.25)'
                    : 'rgba(255,255,255,0.06)'}`,
                borderRadius: '8px',
                cursor: 'pointer',
                transition: 'all 0.12s',
              }}
            >
              <div style={{
                fontSize: '0.78rem',
                color: 'white',
                fontWeight: '500',
                lineHeight: 1.35,
                marginBottom: '3px',
              }}>
                {isBlend ? '⭐ ' : ''}{emoji} {c.title.length > 38 ? c.title.slice(0, 38) + '…' : c.title}
              </div>
              <div style={{ fontSize: '0.67rem', color: '#444' }}>
                {c.num_messages || 0} msgs · {(c.created_at || '').slice(0, 10)}
              </div>
            </div>
          )
        })}

        {display.length === 0 && (
          <div style={{ color: '#333', fontSize: '0.78rem', textAlign: 'center', marginTop: '24px' }}>
            No conversations match
          </div>
        )}
      </div>
    </div>
  )
}
