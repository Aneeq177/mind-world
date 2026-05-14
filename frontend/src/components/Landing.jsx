import { useState, useEffect } from 'react'
import { useStore } from '../store'
import { processFiles } from '../api'

const CHROME_STORE_URL = 'https://chrome.google.com/webstore/detail/mind-world'

const FEATURES = [
  {
    icon: '🧠',
    title: 'Memory across sessions',
    desc: 'Mind World watches what you type and surfaces the past conversations that matter — without you having to ask.'
  },
  {
    icon: '🌍',
    title: 'Your mind in 2D',
    desc: 'Upload your Claude and ChatGPT history and see every conversation mapped as a glowing orb in a 2D universe, clustered by topic.'
  },
  {
    icon: '⚡',
    title: 'Prompt engineering',
    desc: 'Stop re-explaining yourself. Mind World rewrites your draft into a complete, contextual prompt using what you already know.'
  }
]

const LOADING_MESSAGES = [
  'Reading your conversations...',
  'Generating embeddings...',
  'Mapping your mind in 2D...',
  'Identifying your unique topics...',
  'Building your universe...'
]

export default function Landing() {
  const setPhase = useStore(s => s.setPhase)
  const phase = useStore(s => s.phase)
  const setConversations = useStore(s => s.setConversations)
  const setCredentials = useStore(s => s.setCredentials)

  const [view, setView] = useState('home')
  const [claudeFile, setClaudeFile] = useState(null)
  const [chatgptFile, setChatgptFile] = useState(null)
  const [apiKey, setApiKey] = useState('')
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [loadingMsg, setLoadingMsg] = useState('')

  // If the popup opened this page with ?email=..., pre-fill and jump to upload
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const emailParam = params.get('email')
    if (emailParam) {
      setEmail(emailParam)
      setView('upload')
    }
  }, [])

  const canGenerate = (claudeFile || chatgptFile) && apiKey && email

  async function handleGenerate() {
    if (!canGenerate) return
    if (!email.includes('@') || !email.includes('.')) {
      setError('Please enter a valid email address.')
      return
    }

    setError('')
    setLoadingMsg(LOADING_MESSAGES[0])
    setPhase('processing')

    let msgIndex = 0
    const msgInterval = setInterval(() => {
      msgIndex = (msgIndex + 1) % LOADING_MESSAGES.length
      setLoadingMsg(LOADING_MESSAGES[msgIndex])
    }, 4000)

    try {
      const data = await processFiles({ claudeFile, chatgptFile, apiKey, email })
      clearInterval(msgInterval)
      setCredentials(email, apiKey)
      setConversations(data.conversations, data.sources)
      setPhase('map')
    } catch (err) {
      clearInterval(msgInterval)
      let errorMsg = 'Something went wrong. Please try again.'
      if (typeof err === 'string') errorMsg = err
      else if (err?.message && typeof err.message === 'string') errorMsg = err.message
      else if (err?.detail && typeof err.detail === 'string') errorMsg = err.detail
      setError(errorMsg)
      setPhase('landing')
    }
  }

  if (phase === 'processing') {
    return (
      <div style={{
        width: '100vw', height: '100vh',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        background: '#000008', color: 'white', gap: '24px'
      }}>
        <div style={{ fontSize: '4rem' }}>🌍</div>
        <div style={{ fontSize: '1.2rem', color: '#888', minHeight: '2rem', textAlign: 'center' }}>
          {loadingMsg}
        </div>
        <div style={{
          width: '200px', height: '2px',
          background: 'rgba(255,255,255,0.1)',
          borderRadius: '1px', overflow: 'hidden'
        }}>
          <div style={{
            height: '100%', background: '#7c3aed',
            animation: 'progress 60s linear forwards', width: '0%'
          }} />
        </div>
        <style>{`@keyframes progress { from { width: 0% } to { width: 90% } }`}</style>
      </div>
    )
  }

  if (view === 'upload') {
    return (
      <div style={{
        width: '100vw', height: '100vh',
        overflowY: 'auto',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        padding: 'max(48px, calc(50vh - 320px)) 24px',
        boxSizing: 'border-box',
        background: '#000008',
        backgroundImage: 'radial-gradient(ellipse at center, #0a0a1a 0%, #000008 100%)'
      }}>
        <div style={{
          width: '480px', padding: '48px',
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: '24px', color: 'white'
        }}>
          <button
            onClick={() => setView('home')}
            style={{
              background: 'none', border: 'none', color: '#555',
              fontSize: '0.82rem', cursor: 'pointer', marginBottom: '24px',
              padding: 0, display: 'flex', alignItems: 'center', gap: '4px'
            }}
          >
            ← Back
          </button>

          <div style={{ textAlign: 'center', marginBottom: '40px' }}>
            <div style={{ fontSize: '3rem', marginBottom: '12px' }}>🌍</div>
            <h1 style={{ fontSize: '1.8rem', fontWeight: '700', marginBottom: '8px' }}>
              Build your universe
            </h1>
            <p style={{ color: '#888', fontSize: '0.9rem', lineHeight: '1.6' }}>
              Upload your conversation exports and Mind World<br />
              maps your AI history in 2D.
            </p>
          </div>

          <div style={{ display: 'flex', gap: '12px', marginBottom: '16px' }}>
            <label style={{
              flex: 1, padding: '16px', textAlign: 'center',
              border: `1px dashed ${claudeFile ? '#7c3aed' : 'rgba(255,255,255,0.15)'}`,
              borderRadius: '12px', cursor: 'pointer',
              background: claudeFile ? 'rgba(124,58,237,0.1)' : 'transparent',
              transition: 'all 0.2s'
            }}>
              <div style={{ fontSize: '1.5rem', marginBottom: '4px' }}>🟣</div>
              <div style={{ fontSize: '0.8rem', color: '#888' }}>
                {claudeFile ? claudeFile.name.slice(0, 20) + '...' : 'Claude export'}
              </div>
              <div style={{ fontSize: '0.7rem', color: '#555', marginTop: '2px' }}>conversations.json</div>
              <input type="file" accept=".json" style={{ display: 'none' }}
                onChange={e => setClaudeFile(e.target.files[0])} />
            </label>

            <label style={{
              flex: 1, padding: '16px', textAlign: 'center',
              border: `1px dashed ${chatgptFile ? '#10a37f' : 'rgba(255,255,255,0.15)'}`,
              borderRadius: '12px', cursor: 'pointer',
              background: chatgptFile ? 'rgba(16,163,127,0.1)' : 'transparent',
              transition: 'all 0.2s'
            }}>
              <div style={{ fontSize: '1.5rem', marginBottom: '4px' }}>🟢</div>
              <div style={{ fontSize: '0.8rem', color: '#888' }}>
                {chatgptFile ? chatgptFile.name.slice(0, 20) + '...' : 'ChatGPT export'}
              </div>
              <div style={{ fontSize: '0.7rem', color: '#555', marginTop: '2px' }}>.zip file</div>
              <input type="file" accept=".zip" style={{ display: 'none' }}
                onChange={e => setChatgptFile(e.target.files[0])} />
            </label>
          </div>

          <input
            type="email" placeholder="your@email.com"
            value={email} onChange={e => setEmail(e.target.value)}
            style={{
              width: '100%', padding: '14px 16px',
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: '10px', color: 'white',
              fontSize: '0.9rem', marginBottom: '12px', outline: 'none'
            }}
          />

          <input
            type="password" placeholder="Anthropic API key (sk-ant-...)"
            value={apiKey} onChange={e => setApiKey(e.target.value)}
            style={{
              width: '100%', padding: '14px 16px',
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: '10px', color: 'white',
              fontSize: '0.9rem', marginBottom: '24px', outline: 'none'
            }}
          />

          {error && (
            <div style={{
              padding: '12px',
              background: 'rgba(255,68,68,0.1)',
              border: '1px solid rgba(255,68,68,0.3)',
              borderRadius: '8px', color: '#ff6b6b',
              fontSize: '0.85rem', marginBottom: '16px'
            }}>
              {error}
            </div>
          )}

          <button
            onClick={handleGenerate} disabled={!canGenerate}
            style={{
              width: '100%', padding: '16px',
              background: canGenerate
                ? 'linear-gradient(135deg, #7c3aed, #5b21b6)'
                : 'rgba(255,255,255,0.05)',
              border: 'none', borderRadius: '12px',
              color: canGenerate ? 'white' : '#555',
              fontSize: '1rem', fontWeight: '600',
              cursor: canGenerate ? 'pointer' : 'not-allowed',
              transition: 'all 0.2s'
            }}
          >
            🌍 Generate My Universe
          </button>

          <p style={{
            textAlign: 'center', color: '#444',
            fontSize: '0.75rem', marginTop: '16px'
          }}>
            Your data never leaves your session
          </p>
        </div>
      </div>
    )
  }

  // Marketing home
  return (
    <div style={{
      width: '100vw', height: '100vh',
      background: '#000008',
      backgroundImage: 'radial-gradient(ellipse at 50% 0%, #0d0a1f 0%, #000008 60%)',
      color: 'white',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      overflowY: 'auto'
    }}>
      {/* Nav */}
      <nav style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '20px 48px',
        borderBottom: '1px solid rgba(255,255,255,0.05)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: '700', fontSize: '1.05rem' }}>
          <span>🌍</span>
          <span>Mind World</span>
        </div>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <button
            onClick={() => setView('upload')}
            style={{
              padding: '8px 20px',
              background: 'rgba(124,58,237,0.15)',
              border: '1px solid rgba(124,58,237,0.35)',
              borderRadius: '8px', color: '#a78bfa',
              fontSize: '0.85rem', cursor: 'pointer',
              fontWeight: '500'
            }}
          >
            Try the Map
          </button>
          <a
            href={CHROME_STORE_URL}
            target="_blank"
            rel="noreferrer"
            style={{
              padding: '8px 20px',
              background: 'linear-gradient(135deg, #7c3aed, #5b21b6)',
              border: 'none', borderRadius: '8px', color: 'white',
              fontSize: '0.85rem', cursor: 'pointer',
              fontWeight: '600', textDecoration: 'none'
            }}
          >
            Install Extension
          </a>
        </div>
      </nav>

      {/* Hero */}
      <div style={{
        textAlign: 'center',
        padding: '100px 24px 80px',
        maxWidth: '760px', margin: '0 auto'
      }}>
        <div style={{
          display: 'inline-block',
          padding: '6px 14px',
          background: 'rgba(124,58,237,0.12)',
          border: '1px solid rgba(124,58,237,0.3)',
          borderRadius: '20px',
          fontSize: '0.78rem', color: '#a78bfa',
          marginBottom: '32px', letterSpacing: '0.3px'
        }}>
          Memory · Map · Prompt Engineering
        </div>

        <h1 style={{
          fontSize: 'clamp(2.4rem, 5vw, 3.6rem)',
          fontWeight: '800',
          lineHeight: '1.15',
          marginBottom: '24px',
          letterSpacing: '-0.02em'
        }}>
          You've had thousands of<br />
          <span style={{
            background: 'linear-gradient(135deg, #a78bfa, #7c3aed)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent'
          }}>
            great AI conversations.
          </span>
          <br />
          None of them remember you.
        </h1>

        <p style={{
          fontSize: '1.1rem', color: '#888',
          lineHeight: '1.7', marginBottom: '48px',
          maxWidth: '560px', margin: '0 auto 48px'
        }}>
          Mind World gives Claude and ChatGPT memory across sessions — surfaces what you already know,
          maps your entire AI history in 3D, and engineers better prompts from your own past.
        </p>

        <div style={{ display: 'flex', gap: '16px', justifyContent: 'center', flexWrap: 'wrap' }}>
          <a
            href={CHROME_STORE_URL}
            target="_blank"
            rel="noreferrer"
            style={{
              padding: '16px 36px',
              background: 'linear-gradient(135deg, #7c3aed, #5b21b6)',
              border: 'none', borderRadius: '12px', color: 'white',
              fontSize: '1rem', fontWeight: '700', textDecoration: 'none',
              display: 'inline-block'
            }}
          >
            Install Chrome Extension — Free
          </a>
          <button
            onClick={() => setView('upload')}
            style={{
              padding: '16px 36px',
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: '12px', color: '#ccc',
              fontSize: '1rem', fontWeight: '600', cursor: 'pointer'
            }}
          >
            Try the Map →
          </button>
        </div>
      </div>

      {/* Demo placeholder */}
      <div style={{
        maxWidth: '900px', margin: '0 auto 100px',
        padding: '0 24px'
      }}>
        <div style={{
          width: '100%', aspectRatio: '16/9',
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: '20px',
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          gap: '12px', color: '#333'
        }}>
          <div style={{ fontSize: '3rem' }}>🌍</div>
          <div style={{ fontSize: '0.85rem' }}>Demo video coming soon</div>
        </div>
      </div>

      {/* Feature callouts */}
      <div style={{
        maxWidth: '960px', margin: '0 auto 120px',
        padding: '0 24px',
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
        gap: '24px'
      }}>
        {FEATURES.map(f => (
          <div
            key={f.title}
            style={{
              padding: '32px',
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(255,255,255,0.07)',
              borderRadius: '16px'
            }}
          >
            <div style={{ fontSize: '2rem', marginBottom: '16px' }}>{f.icon}</div>
            <div style={{
              fontSize: '1.05rem', fontWeight: '700',
              marginBottom: '10px', color: 'white'
            }}>
              {f.title}
            </div>
            <div style={{ fontSize: '0.88rem', color: '#666', lineHeight: '1.65' }}>
              {f.desc}
            </div>
          </div>
        ))}
      </div>

      {/* Bottom CTA */}
      <div style={{
        textAlign: 'center',
        padding: '80px 24px 100px',
        borderTop: '1px solid rgba(255,255,255,0.05)'
      }}>
        <h2 style={{ fontSize: '2rem', fontWeight: '700', marginBottom: '16px' }}>
          Start remembering.
        </h2>
        <p style={{ color: '#666', fontSize: '0.95rem', marginBottom: '36px' }}>
          Free to install. Works on Claude, ChatGPT, Gemini, and Perplexity.
        </p>
        <a
          href={CHROME_STORE_URL}
          target="_blank"
          rel="noreferrer"
          style={{
            padding: '16px 40px',
            background: 'linear-gradient(135deg, #7c3aed, #5b21b6)',
            border: 'none', borderRadius: '12px', color: 'white',
            fontSize: '1rem', fontWeight: '700', textDecoration: 'none',
            display: 'inline-block'
          }}
        >
          Install Chrome Extension — Free
        </a>
      </div>
    </div>
  )
}
