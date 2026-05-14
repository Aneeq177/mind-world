import { useMemo } from 'react'
import Plotly from 'plotly.js-dist-min'
import createPlotlyComponent from 'react-plotly.js/factory'

const Plot = createPlotlyComponent(Plotly)

export default function MapPlot({ conversations, selectedId, blendIds, onSelect }) {
  const { traces, annotations } = useMemo(() => {
    if (!conversations.length) return { traces: [], annotations: [] }

    const regionMap = {}
    for (const c of conversations) {
      const r = c.region || 'Other'
      if (!regionMap[r]) {
        regionMap[r] = {
          x: [], y: [], text: [], customdata: [],
          size: [], color: [], symbol: [],
          regionColor: c.color || '#666666'
        }
      }

      const isBlend = blendIds.includes(c.id)
      const isFocused = c.id === selectedId
      const msgSize = Math.max(8, Math.min(25, Math.floor((c.num_messages || 4) / 4) + 6))

      regionMap[r].x.push(c.x)
      regionMap[r].y.push(1000 - c.y) // invert Y to match plotly convention
      regionMap[r].size.push(msgSize + (isBlend ? 6 : 0) + (isFocused ? 4 : 0))
      regionMap[r].color.push(isBlend ? 'white' : (c.color || '#666666'))
      regionMap[r].symbol.push(isBlend ? 'star' : (c.source === 'chatgpt' ? 'diamond' : 'circle'))
      regionMap[r].customdata.push(c.id)

      const emoji = c.source === 'claude' ? '🟣' : '🟢'
      regionMap[r].text.push(
        `<b>${c.title}</b><br>` +
        `${emoji} ${(c.source || 'claude').toUpperCase()}<br>` +
        `Region: ${c.region || 'Other'}<br>` +
        `Messages: ${c.num_messages || 0}<br>` +
        `Date: ${(c.created_at || '').slice(0, 10)}<br>` +
        (isBlend ? '⭐ Selected for blend<br>' : '') +
        `<i>${(c.preview || '').slice(0, 120)}…</i>`
      )
    }

    const traces = Object.entries(regionMap).map(([region, d]) => ({
      type: 'scattergl',
      x: d.x,
      y: d.y,
      mode: 'markers',
      name: region,
      marker: {
        size: d.size,
        color: d.color,
        symbol: d.symbol,
        opacity: 0.9,
        line: { width: 1.5, color: 'rgba(255,255,255,0.25)' }
      },
      hovertemplate: '%{text}<extra></extra>',
      text: d.text,
      customdata: d.customdata,
    }))

    // Cluster label annotations — only for regions with 2+ conversations
    const regionCenters = {}
    for (const c of conversations) {
      const r = c.region || 'Other'
      if (!regionCenters[r]) regionCenters[r] = { x: [], y: [], color: c.color || '#666666' }
      regionCenters[r].x.push(c.x)
      regionCenters[r].y.push(1000 - c.y)
    }

    const annotations = Object.entries(regionCenters)
      .filter(([, d]) => d.x.length >= 2)
      .map(([region, d]) => ({
        x: d.x.reduce((a, b) => a + b, 0) / d.x.length,
        y: d.y.reduce((a, b) => a + b, 0) / d.y.length,
        text: region.toUpperCase(),
        showarrow: false,
        font: { size: 10, color: d.color, family: 'monospace' },
        bgcolor: 'rgba(0,0,0,0.55)',
        borderpad: 3,
        opacity: 0.9,
      }))

    return { traces, annotations }
  }, [conversations, selectedId, blendIds])

  const layout = useMemo(() => ({
    paper_bgcolor: '#0a0a0f',
    plot_bgcolor: '#0a0a0f',
    xaxis: { range: [0, 1000], showgrid: true, gridcolor: '#1a1a2e', zeroline: false, showticklabels: false },
    yaxis: { range: [0, 1000], showgrid: true, gridcolor: '#1a1a2e', zeroline: false, showticklabels: false },
    margin: { l: 0, r: 0, t: 10, b: 0 },
    legend: { bgcolor: '#111', bordercolor: '#333', font: { color: '#aaa', size: 10 }, x: 0.01, y: 0.99 },
    hoverlabel: { bgcolor: '#1a1a2e', font: { size: 12, family: 'monospace' } },
    annotations,
    autosize: true,
    dragmode: 'pan',
  }), [annotations])

  if (!conversations.length) {
    return (
      <div style={{
        width: '100%', height: '100%',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#333', fontSize: '0.85rem'
      }}>
        No conversations match your filters
      </div>
    )
  }

  return (
    <Plot
      data={traces}
      layout={layout}
      style={{ width: '100%', height: '100%' }}
      useResizeHandler
      config={{ displayModeBar: false, scrollZoom: true }}
      onClick={(evt) => {
        if (evt.points && evt.points[0] && evt.points[0].customdata) {
          onSelect(evt.points[0].customdata)
        }
      }}
    />
  )
}
