import { useMemo, useState } from 'react'

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

export default function TimeMachine({ conversations }) {
  const months = useMemo(() => buildMonths(conversations), [conversations])
  const [idx, setIdx] = useState(() => months.length > 0 ? months.length - 1 : 0)
  const [open, setOpen] = useState(false)

  const safeIdx = Math.min(idx, Math.max(0, months.length - 1))

  const { timeFiltered, newThisMonth } = useMemo(() => {
    if (!months.length) return { timeFiltered: [], newThisMonth: [] }
    const cutoff = months[safeIdx]
    const cutoffEnd = new Date(cutoff.getFullYear(), cutoff.getMonth() + 1, 1)

    const timeFiltered = conversations.filter(c => {
      try { return new Date(c.created_at) < cutoffEnd } catch { return false }
    })
    const newThisMonth = timeFiltered.filter(c => {
      try {
        const d = new Date(c.created_at)
        return d >= cutoff && d < cutoffEnd
      } catch { return false }
    })
    return { timeFiltered, newThisMonth }
  }, [conversations, months, safeIdx])

  if (!months.length) return null

  return (
    <div>
      {/* Header row — always visible */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: '0.82rem', fontWeight: '700', color: 'white' }}>
          ⏳ Time Machine
        </div>
        <button
          onClick={() => setOpen(o => !o)}
          style={{
            background: 'none',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: '4px',
            color: '#888',
            fontSize: '0.7rem',
            padding: '2px 8px',
            cursor: 'pointer',
          }}
        >
          {open ? '▼' : '▲'}
        </button>
      </div>

      {/* Collapsible body */}
      {open && (
        <div style={{ marginTop: '12px' }}>
          {/* Month labels */}
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.68rem', color: '#444', marginBottom: '6px' }}>
            <span>{fmt(months[0])}</span>
            <span style={{ color: '#a78bfa', fontWeight: '600' }}>{fmt(months[safeIdx])}</span>
            <span>{fmt(months[months.length - 1])}</span>
          </div>

          {/* Slider */}
          <input
            type="range"
            min={0}
            max={months.length - 1}
            value={safeIdx}
            onChange={e => setIdx(Number(e.target.value))}
            style={{ width: '100%', accentColor: '#7c3aed', cursor: 'pointer', marginBottom: '14px' }}
          />

          {/* Stats */}
          <div style={{ display: 'flex', gap: '20px', marginBottom: '14px' }}>
            {[
              { label: 'by this date', value: timeFiltered.length },
              { label: 'new this month', value: newThisMonth.length },
              { label: 'total messages', value: timeFiltered.reduce((a, c) => a + (c.num_messages || 0), 0).toLocaleString() },
            ].map(({ label, value }) => (
              <div key={label}>
                <div style={{ fontSize: '1rem', fontWeight: '700', color: 'white' }}>{value}</div>
                <div style={{ fontSize: '0.65rem', color: '#555' }}>{label}</div>
              </div>
            ))}
          </div>

          {/* New conversations list */}
          {newThisMonth.length > 0 && (
            <div>
              <div style={{ fontSize: '0.72rem', fontWeight: '600', color: '#a78bfa', marginBottom: '8px' }}>
                🆕 New in {fmt(months[safeIdx])}
              </div>
              {newThisMonth.map(c => (
                <div key={c.id} style={{ fontSize: '0.73rem', color: '#777', marginBottom: '4px' }}>
                  {c.source === 'claude' ? '🟣' : '🟢'} {c.title.slice(0, 52)}{c.title.length > 52 ? '…' : ''}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
