import { useMemo, useState } from 'react'
import Plotly from 'plotly.js-dist-min'
import createPlotlyComponent from 'react-plotly.js/factory'

const Plot = createPlotlyComponent(Plotly)

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

  // Keep idx valid when months change (e.g. filter changes)
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

  const traces = useMemo(() => {
    if (!timeFiltered.length) return []
    const newSet = new Set(newThisMonth.map(c => c.id))
    const regionMap = {}

    for (const c of timeFiltered) {
      const r = c.region || 'Other'
      const isNew = newSet.has(c.id)
      if (!regionMap[r]) regionMap[r] = { x: [], y: [], text: [], size: [], color: [], opacity: [], symbol: [] }
      const sz = Math.max(8, Math.min(25, Math.floor((c.num_messages || 4) / 4) + 6))
      regionMap[r].x.push(c.x)
      regionMap[r].y.push(1000 - c.y)
      regionMap[r].size.push(sz + (isNew ? 6 : 0))
      regionMap[r].color.push(c.color || '#666666')
      regionMap[r].opacity.push(isNew ? 1.0 : 0.25)
      regionMap[r].symbol.push(c.source === 'chatgpt' ? 'diamond' : 'circle')
      regionMap[r].text.push(
        `<b>${c.title}</b>${isNew ? ' 🆕' : ''}<br>` +
        `Added: ${(c.created_at || '').slice(0, 10)}<br>` +
        `Messages: ${c.num_messages || 0}`
      )
    }

    const result = Object.entries(regionMap).map(([region, d]) => ({
      type: 'scattergl',
      x: d.x, y: d.y,
      mode: 'markers',
      name: region,
      marker: { size: d.size, color: d.color, symbol: d.symbol, opacity: d.opacity, line: { width: 1, color: 'rgba(255,255,255,0.15)' } },
      hovertemplate: '%{text}<extra></extra>',
      text: d.text,
    }))

    // White halo rings for new conversations
    for (const c of newThisMonth) {
      const sz = Math.max(8, Math.min(25, Math.floor((c.num_messages || 4) / 4) + 6))
      result.push({
        type: 'scattergl',
        x: [c.x], y: [1000 - c.y],
        mode: 'markers',
        showlegend: false,
        hoverinfo: 'skip',
        marker: { size: sz + 14, color: 'rgba(0,0,0,0)', line: { width: 2, color: 'white' } },
      })
    }
    return result
  }, [timeFiltered, newThisMonth])

  const layout = {
    paper_bgcolor: '#0a0a0f',
    plot_bgcolor: '#0a0a0f',
    xaxis: { range: [0, 1000], showgrid: true, gridcolor: '#1a1a2e', zeroline: false, showticklabels: false },
    yaxis: { range: [0, 1000], showgrid: true, gridcolor: '#1a1a2e', zeroline: false, showticklabels: false },
    margin: { l: 0, r: 0, t: 8, b: 0 },
    legend: { bgcolor: '#111', bordercolor: '#333', font: { color: '#aaa', size: 10 }, x: 0.01, y: 0.99 },
    hoverlabel: { bgcolor: '#1a1a2e', font: { size: 12, family: 'monospace' } },
    autosize: true,
  }

  if (!months.length) return null

  return (
    <div>
      <div style={{ fontSize: '0.82rem', fontWeight: '700', color: 'white', marginBottom: '14px' }}>
        ⏳ Time Machine
      </div>

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
      <div style={{ display: 'flex', gap: '20px', marginBottom: '16px' }}>
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

      {/* Time-filtered map */}
      <div style={{ height: '380px' }}>
        <Plot
          data={traces}
          layout={layout}
          style={{ width: '100%', height: '100%' }}
          useResizeHandler
          config={{ displayModeBar: false, scrollZoom: true }}
        />
      </div>

      {/* New conversations list */}
      {newThisMonth.length > 0 && (
        <div style={{ marginTop: '14px' }}>
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
  )
}
