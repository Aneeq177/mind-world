import { useMemo, useRef, useState } from 'react'
import Plotly from 'plotly.js-dist-min'
import createPlotlyComponent from 'react-plotly.js/factory'

const Plot = createPlotlyComponent(Plotly)

export default function MapPlot({ conversations, newIds = new Set(), selectedId, blendIds, searchMatchIds = new Set(), onSelect }) {
  const plotRef = useRef(null)
  const [agentTraces, setAgentTraces] = useState([])
  const isTimeFiltered = newIds.size > 0
  const isSearchActive = searchMatchIds.size > 0

  const { traces, annotations } = useMemo(() => {
    if (!conversations.length) return { traces: [], annotations: [] }

    const regionMap = {}
    for (const c of conversations) {
      const r = c.region || 'Other'
      if (!regionMap[r]) {
        regionMap[r] = {
          x: [], y: [], text: [], customdata: [],
          size: [], color: [], symbol: [], opacity: [],
          regionColor: c.color || '#666666'
        }
      }

      const isBlend = blendIds.includes(c.id)
      const isFocused = c.id === selectedId
      const isNew = newIds.has(c.id)
      const msgSize = Math.max(8, Math.min(25, Math.floor((c.num_messages || 4) / 4) + 6))

      regionMap[r].x.push(c.x)
      regionMap[r].y.push(1000 - c.y)
      regionMap[r].size.push(msgSize + (isBlend ? 6 : 0) + (isFocused ? 4 : 0) + (isNew ? 2 : 0))
      regionMap[r].color.push(isBlend ? 'white' : (c.is_team ? '#14b8a6' : (c.color || '#666666')))
      regionMap[r].symbol.push(isBlend ? 'star' : (c.is_team ? 'triangle-up' : (c.source === 'chatgpt' ? 'diamond' : 'circle')))
      let opacity
      if (isSearchActive) {
        opacity = searchMatchIds.has(c.id) ? 0.9 : 0.1
      } else if (isTimeFiltered) {
        opacity = isNew ? 1.0 : 0.4
      } else {
        opacity = 0.9
      }
      regionMap[r].opacity.push(opacity)
      regionMap[r].customdata.push(c.id)

      const truncated = c.title.length > 35 ? c.title.slice(0, 35) + '...' : c.title
      const teamLabel = c.is_team && c.owner_initials ? ` · Team (${c.owner_initials})` : ''
      regionMap[r].text.push(
        `<b>${truncated}</b><br>` +
        `${c.region || 'Other'} · ${c.num_messages || 0} msgs${teamLabel}`
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
        opacity: d.opacity,
        line: { width: 1.5, color: 'rgba(255,255,255,0.25)' }
      },
      hovertemplate: '%{text}<extra></extra>',
      text: d.text,
      customdata: d.customdata,
    }))

    // White halo rings for new conversations
    for (const c of conversations) {
      if (!newIds.has(c.id)) continue
      const sz = Math.max(8, Math.min(25, Math.floor((c.num_messages || 4) / 4) + 6))
      traces.push({
        type: 'scattergl',
        x: [c.x],
        y: [1000 - c.y],
        mode: 'markers',
        showlegend: false,
        hoverinfo: 'skip',
        marker: { size: sz + 14, color: 'rgba(0,0,0,0)', line: { width: 2, color: 'white' } },
      })
    }

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
  }, [conversations, selectedId, blendIds, newIds, isTimeFiltered, searchMatchIds, isSearchActive])

  const layout = useMemo(() => ({
    paper_bgcolor: '#0a0a0f',
    plot_bgcolor: '#0a0a0f',
    xaxis: { range: [0, 1000], showgrid: true, gridcolor: '#1a1a2e', zeroline: false, showticklabels: false },
    yaxis: { range: [0, 1000], showgrid: true, gridcolor: '#1a1a2e', zeroline: false, showticklabels: false },
    margin: { l: 40, r: 40, t: 20, b: 20 },
    height: undefined,
    showlegend: false,
    hoverlabel: {
      bgcolor: 'rgba(10,10,20,0.9)',
      bordercolor: 'rgba(255,255,255,0.15)',
      font: { size: 11, color: 'white', family: 'monospace' },
      align: 'left',
      namelength: 0,
    },
    annotations,
    autosize: true,
    dragmode: 'pan',
    uirevision: 'true',
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
    <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, width: '100%', height: '100%' }}>
      <Plot
        ref={plotRef}
        data={[...traces, ...agentTraces]}
        layout={layout}
        style={{ width: '100%', height: '100%' }}
        useResizeHandler={true}
        config={{ displayModeBar: false, scrollZoom: true }}
        onClick={(evt) => {
          if (evt.points && evt.points[0] && evt.points[0].customdata) {
            onSelect(evt.points[0].customdata)
          }
        }}
      />
    </div>
  )
}
