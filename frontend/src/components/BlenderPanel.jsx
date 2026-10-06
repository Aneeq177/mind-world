import { useState } from 'react'
import { engineerPrompt } from '../api'

const BORDER = 'rgba(255,255,255,0.08)'
const ACCENT = 'rgba(59,130,246,0.25)'
const ACCENT_BORDER = 'rgba(59,130,246,0.4)'

export default function BlenderPanel({ blendIds, conversations, email, onRemove, onClear }) {
  const [prompt, setPrompt] = useState('')
  const [result, setResult] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const lookup = Object.fromEntries(conversations.map(c => [c.id, c]))

  async function handleBlend() {
    if (!blendIds.length) return
    setLoading(true)
    setError('')
    setResult('')
    try {
      const data = await engineerPrompt({
        email,
        message: prompt.trim() || 'What patterns, connections, and next steps do you see across these conversations?',
        conversationIds: blendIds
      })
      setResult(data.engineered_prompt || '')
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      height: '100%',
      padding: '16px',
      display: 'flex',
      flexDirection: 'column',
      gap: '10px',
      overflowY: 'auto',
    }}>
      <div style={{
        fontSize: '0.72rem',
        fontWeight: '700',
        color: '#888',
        textTransform: 'uppercase',
        letterSpacing: '0.8px',
        flexShrink: 0,
      }}>
        🔀 Context Blender
      </div>

      {blendIds.length === 0 ? (
        <div style={{ color: '#3a3a4a', fontSize: '0.78rem', lineHeight: 1.7, marginTop: '4px' }}>
          Click <strong style={{ color: '#555' }}>+ Add to Blend</strong> on any conversation in the detail panel, or click a dot on the map.
          <br /><br />
          Up to 4 conversations can be blended together with an AI-engineered prompt.
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', flexShrink: 0 }}>
            {blendIds.map(id => {
              const c = lookup[id]
              if (!c) return null
              const emoji = c.source === 'claude' ? '🟣' : '🟢'
              return (
                <div key={id} style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  justifyContent: 'space-between',
                  gap: '8px',
                  padding: '8px 10px',
                  background: ACCENT,
                  border: `1px solid ${ACCENT_BORDER}`,
                  borderRadius: '8px',
                }}>
                  <div style={{ fontSize: '0.75rem', color: '#ccc', lineHeight: 1.4, flex: 1 }}>
                    {emoji} {c.title.length > 36 ? c.title.slice(0, 36) + '…' : c.title}
                  </div>
                  <button
                    onClick={() => onRemove(id)}
                    style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: '1rem', lineHeight: 1, flexShrink: 0 }}
                  >
                    ×
                  </button>
                </div>
              )
            })}
            {blendIds.length > 1 && (
              <button
                onClick={onClear}
                style={{ background: 'none', border: 'none', color: '#444', fontSize: '0.7rem', cursor: 'pointer', textAlign: 'left', padding: 0 }}
              >
                Clear all
              </button>
            )}
          </div>

          <textarea
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            placeholder="Your question or prompt (optional)…"
            style={{
              width: '100%',
              padding: '10px',
              background: 'rgba(255,255,255,0.04)',
              border: `1px solid ${BORDER}`,
              borderRadius: '8px',
              color: 'white',
              fontSize: '0.78rem',
              resize: 'vertical',
              minHeight: '68px',
              outline: 'none',
              fontFamily: 'inherit',
              boxSizing: 'border-box',
              flexShrink: 0,
            }}
          />

          <button
            onClick={handleBlend}
            disabled={loading}
            style={{
              width: '100%',
              padding: '11px',
              background: loading ? 'rgba(255,255,255,0.05)' : '#3b82f6',
              border: 'none',
              borderRadius: '8px',
              color: loading ? '#555' : 'white',
              fontSize: '0.85rem',
              fontWeight: '600',
              cursor: loading ? 'not-allowed' : 'pointer',
              transition: 'all 0.2s',
              flexShrink: 0,
            }}
          >
            {loading ? 'Engineering…' : 'Blend Conversations'}
          </button>
        </>
      )}

      {error && (
        <div style={{ color: '#ff6b6b', fontSize: '0.73rem', flexShrink: 0 }}>{error}</div>
      )}

      {result && (
        <>
          <textarea
            value={result}
            onChange={e => setResult(e.target.value)}
            style={{
              width: '100%',
              padding: '10px',
              background: 'rgba(255,255,255,0.03)',
              border: `1px solid ${BORDER}`,
              borderRadius: '8px',
              color: '#ddd',
              fontSize: '0.75rem',
              resize: 'vertical',
              minHeight: '140px',
              outline: 'none',
              fontFamily: 'inherit',
              lineHeight: 1.6,
              boxSizing: 'border-box',
              flexShrink: 0,
            }}
          />
          <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
            <button
              onClick={() => window.open(`https://claude.ai/new?q=${encodeURIComponent(result)}`, '_blank')}
              style={{ flex: 1, padding: '9px', background: '#3b82f6', border: 'none', borderRadius: '7px', color: 'white', fontSize: '0.78rem', fontWeight: '600', cursor: 'pointer' }}
            >
              🟣 Claude
            </button>
            <button
              onClick={() => window.open(`https://chatgpt.com/?q=${encodeURIComponent(result)}`, '_blank')}
              style={{ flex: 1, padding: '9px', background: '#059669', border: 'none', borderRadius: '7px', color: 'white', fontSize: '0.78rem', fontWeight: '600', cursor: 'pointer' }}
            >
              🟢 ChatGPT
            </button>
          </div>
        </>
      )}
    </div>
  )
}
