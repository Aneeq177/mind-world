export default function DetailPanel({ conversation: c, isBlended, onClose, onToggleBlend, onDelete, isDeleting }) {
  if (!c) return null

  const isClaude = c.source === 'claude' || c.source_app === 'claude'

  const badgeStyle = {
    fontSize: '0.68rem',
    padding: '3px 10px',
    background: isClaude ? 'rgba(217,119,87,0.18)' : 'rgba(16,185,129,0.18)',
    border: `1px solid ${isClaude ? 'rgba(217,119,87,0.4)' : 'rgba(16,185,129,0.4)'}`,
    borderRadius: '10px',
    color: isClaude ? '#e8a082' : '#34d399',
    fontWeight: '600',
  }

  const badgeText = isClaude ? 'Claude' : 'ChatGPT'

  const metaItems = [
    { label: 'Messages', value: c.num_messages || 0 },
    { label: 'Topic', value: (c.region || 'Other').slice(0, 14) },
    { label: 'Date', value: (c.created_at || '').slice(0, 10) },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: '12px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={badgeStyle}>{badgeText}</span>
        <button
          onClick={onClose}
          style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: '1.3rem', lineHeight: 1 }}
        >
          ×
        </button>
      </div>

      <div style={{ fontSize: '0.88rem', fontWeight: '700', color: 'white', lineHeight: 1.4 }}>
        {c.title}
      </div>

      <div style={{ display: 'flex', gap: '8px' }}>
        {metaItems.map(({ label, value }) => (
          <div key={label} style={{
            flex: 1,
            padding: '8px 4px',
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.07)',
            borderRadius: '7px',
            textAlign: 'center',
          }}>
            <div style={{ fontSize: '0.82rem', fontWeight: '700', color: 'white' }}>{value}</div>
            <div style={{ fontSize: '0.62rem', color: '#555', marginTop: '2px' }}>{label}</div>
          </div>
        ))}
      </div>

      <div style={{
        flex: 1,
        overflowY: 'auto',
        fontSize: '0.75rem',
        color: '#777',
        lineHeight: 1.65,
        padding: '10px',
        background: 'rgba(255,255,255,0.02)',
        border: '1px solid rgba(255,255,255,0.05)',
        borderRadius: '7px',
        whiteSpace: 'pre-wrap',
      }}>
        {`${(c.preview || '').slice(0, 400)}${(c.preview || '').length > 400 ? '…' : ''}`}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', flexShrink: 0 }}>
        {isClaude && (
          <a
            href={`https://claude.ai/chat/${c.id}`}
            target="_blank"
            rel="noreferrer"
            style={{
              display: 'block',
              padding: '9px',
              background: 'rgba(59,130,246,0.1)',
              border: '1px solid rgba(59,130,246,0.3)',
              borderRadius: '7px',
              color: '#60a5fa',
              fontSize: '0.78rem',
              fontWeight: '600',
              textDecoration: 'none',
              textAlign: 'center',
            }}
          >
            🟣 Open in Claude ↗
          </a>
        )}

        {onDelete && (
          <button
            onClick={onDelete}
            disabled={isDeleting}
            style={{
              padding: '9px',
              background: 'rgba(248,113,113,0.08)',
              border: '1px solid rgba(248,113,113,0.35)',
              borderRadius: '7px',
              color: '#f87171',
              fontSize: '0.78rem',
              fontWeight: '600',
              cursor: isDeleting ? 'not-allowed' : 'pointer',
              opacity: isDeleting ? 0.6 : 1,
            }}
          >
            {isDeleting ? 'Deleting…' : 'Delete this conversation'}
          </button>
        )}

        <button
          onClick={onToggleBlend}
          style={{
            padding: '9px',
            background: isBlended ? 'rgba(59,130,246,0.22)' : 'rgba(255,255,255,0.05)',
            border: `1px solid ${isBlended ? 'rgba(59,130,246,0.5)' : 'rgba(255,255,255,0.1)'}`,
            borderRadius: '7px',
            color: isBlended ? '#60a5fa' : '#888',
            fontSize: '0.78rem',
            fontWeight: '600',
            cursor: 'pointer',
            transition: 'all 0.15s',
          }}
        >
          {isBlended ? '⭐ In Blend — Remove' : '+ Add to Blend'}
        </button>
      </div>
    </div>
  )
}
