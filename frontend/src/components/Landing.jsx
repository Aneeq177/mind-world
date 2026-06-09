import { useState, useEffect } from 'react'
import { useStore } from '../store'
import { processFiles, loadExistingMap } from '../api'

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
    desc: 'Upload your Claude and ChatGPT history and see every conversation mapped on a 2D canvas, clustered by topic.'
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
  'Building your map...'
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
  const [hasExistingData, setHasExistingData] = useState(false)
  const [existingCount, setExistingCount] = useState(0)
  const [checkingEmail, setCheckingEmail] = useState(false)
  const [selectedPlatform, setSelectedPlatform] = useState('chatgpt')
  const [showAdvanced, setShowAdvanced] = useState(false)

  // If the popup opened this page with ?email=..., pre-fill, jump to upload, and check for data
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const emailParam = params.get('email')
    const autoLoad = params.get('autoLoad')
    
    if (emailParam) {
      setEmail(emailParam)
      setView('upload')
      
      if (autoLoad === 'true') {
        autoLoadMap(emailParam)
      } else {
        checkExistingData(emailParam)
      }
    }
  }, [])

  async function autoLoadMap(emailValue) {
    setError('')
    setLoadingMsg('Loading your map...')
    setPhase('processing')
    try {
      const data = await loadExistingMap(emailValue)
      setCredentials(emailValue, apiKey || '')
      setConversations(data.conversations, data.sources)
      setPhase('map')
    } catch (err) {
      setError(err.message || 'Failed to load map')
      setPhase('landing')
    }
  }

  async function checkExistingData(emailValue) {
    if (!emailValue || !emailValue.includes('@')) return
    setCheckingEmail(true)
    try {
      const data = await loadExistingMap(emailValue)
      if (data.has_data && data.total > 0) {
        setHasExistingData(true)
        setExistingCount(data.total)
      } else {
        setHasExistingData(false)
        setExistingCount(0)
      }
    } catch {
      setHasExistingData(false)
    } finally {
      setCheckingEmail(false)
    }
  }

  async function handleLoadExisting() {
    if (!email) return
    setError('')
    setLoadingMsg('Loading your map...')
    setPhase('processing')
    try {
      const data = await loadExistingMap(email)
      setCredentials(email, apiKey || '')
      setConversations(data.conversations, data.sources)
      setPhase('map')
    } catch (err) {
      setError(err.message || 'Failed to load map')
      setPhase('landing')
    }
  }

  function handleSingleFileUpload(file) {
    if (!file) return
    const name = file.name.toLowerCase()
    if (name.endsWith('.json')) {
      setClaudeFile(file)
      setChatgptFile(null)
      setSelectedPlatform('claude')
    } else if (name.endsWith('.zip')) {
      setChatgptFile(file)
      setClaudeFile(null)
      setSelectedPlatform('chatgpt')
    } else {
      setError('Please upload the .zip file from ChatGPT or conversations.json from Claude.')
    }
  }

  const hasFile = claudeFile || chatgptFile
  const canGenerate = email && email.includes('@') && (hasFile || hasExistingData)

  async function handleGenerate() {
    if (!canGenerate) return
    // If no new files but existing data, just load from DB
    if (!claudeFile && !chatgptFile && hasExistingData) {
      return handleLoadExisting()
    }
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

  const EXPORT_STEPS = {
    chatgpt: [
      'Open chatgpt.com and click your profile picture (bottom-left)',
      'Go to Settings → Data controls → Export data',
      'Confirm the export — OpenAI emails you a download link',
      'Download the .zip file from the email, then upload it below'
    ],
    claude: [
      'Open claude.ai and click your initials (bottom-left)',
      'Go to Settings → Privacy → Export data',
      'Download conversations.json when it\'s ready',
      'Upload that file below'
    ]
  }

  if (view === 'upload') {
    const uploadedFile = claudeFile || chatgptFile

    return (
      <div style={{
        width: '100vw', minHeight: '100vh',
        overflowY: 'auto',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        padding: 'max(32px, calc(50vh - 380px)) 24px 48px',
        boxSizing: 'border-box',
        background: '#000008',
        backgroundImage: 'radial-gradient(ellipse at center, #0a0a1a 0%, #000008 100%)'
      }}>
        <div style={{
          width: '520px', maxWidth: '100%', padding: '40px',
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: '24px', color: 'white'
        }}>
          <button
            onClick={() => setView('home')}
            style={{
              background: 'none', border: 'none', color: '#555',
              fontSize: '0.82rem', cursor: 'pointer', marginBottom: '20px',
              padding: 0, display: 'flex', alignItems: 'center', gap: '4px'
            }}
          >
            ← Back
          </button>

          <div style={{ textAlign: 'center', marginBottom: '32px' }}>
            <div style={{ fontSize: '2.5rem', marginBottom: '10px' }}>🌍</div>
            <h1 style={{ fontSize: '1.6rem', fontWeight: '700', marginBottom: '8px' }}>
              Import your AI chats
            </h1>
            <p style={{ color: '#888', fontSize: '0.9rem', lineHeight: '1.6' }}>
              One-time setup. Takes about 2 minutes.
            </p>
          </div>

          {hasExistingData && !checkingEmail && (
            <div style={{
              background: 'rgba(124,58,237,0.1)',
              border: '1px solid rgba(124,58,237,0.3)',
              borderRadius: '10px',
              padding: '14px 16px',
              marginBottom: '20px'
            }}>
              <div style={{ color: '#a78bfa', fontWeight: '600', marginBottom: '4px' }}>
                ✓ You already have {existingCount} conversations saved
              </div>
              <button
                onClick={handleLoadExisting}
                style={{
                  width: '100%', padding: '12px', marginTop: '8px',
                  background: 'linear-gradient(135deg, #7c3aed, #5b21b6)',
                  border: 'none', borderRadius: '8px',
                  color: 'white', fontSize: '0.9rem', fontWeight: '600',
                  cursor: 'pointer'
                }}
              >
                Open my map →
              </button>
              <div style={{ color: '#555', fontSize: '0.75rem', textAlign: 'center', marginTop: '8px' }}>
                or add more chats below
              </div>
            </div>
          )}

          {/* Step 1: Which AI? */}
          <div style={{ marginBottom: '20px' }}>
            <div style={{ fontSize: '0.75rem', color: '#666', marginBottom: '10px', fontWeight: '600' }}>
              STEP 1 — Which AI do you use?
            </div>
            <div style={{ display: 'flex', gap: '10px' }}>
              {[
                { id: 'chatgpt', label: 'ChatGPT', emoji: '🟢' },
                { id: 'claude', label: 'Claude', emoji: '🟣' }
              ].map(p => (
                <button
                  key={p.id}
                  onClick={() => setSelectedPlatform(p.id)}
                  style={{
                    flex: 1, padding: '14px',
                    borderRadius: '10px', cursor: 'pointer',
                    border: selectedPlatform === p.id
                      ? (p.id === 'chatgpt' ? '1px solid rgba(16,163,127,0.5)' : '1px solid rgba(124,58,237,0.5)')
                      : '1px solid rgba(255,255,255,0.1)',
                    background: selectedPlatform === p.id
                      ? (p.id === 'chatgpt' ? 'rgba(16,163,127,0.12)' : 'rgba(124,58,237,0.12)')
                      : 'rgba(255,255,255,0.03)',
                    color: selectedPlatform === p.id ? 'white' : '#888',
                    fontSize: '0.9rem', fontWeight: '600'
                  }}
                >
                  {p.emoji} {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Step 2: How to download */}
          <div style={{
            marginBottom: '20px', padding: '16px',
            background: 'rgba(255,255,255,0.02)',
            border: '1px solid rgba(255,255,255,0.06)',
            borderRadius: '12px'
          }}>
            <div style={{ fontSize: '0.75rem', color: '#666', marginBottom: '12px', fontWeight: '600' }}>
              STEP 2 — Download your chats
            </div>
            <ol style={{ margin: 0, paddingLeft: '20px', fontSize: '0.85rem', color: '#aaa', lineHeight: '1.7' }}>
              {EXPORT_STEPS[selectedPlatform].map((step, i) => (
                <li key={i} style={{ marginBottom: '6px' }}>{step}</li>
              ))}
            </ol>
          </div>

          {/* Step 3: Upload */}
          <div style={{ marginBottom: '16px' }}>
            <div style={{ fontSize: '0.75rem', color: '#666', marginBottom: '10px', fontWeight: '600' }}>
              STEP 3 — Upload the file
            </div>
            <label style={{
              display: 'block', padding: '28px 20px', textAlign: 'center',
              border: `2px dashed ${uploadedFile ? '#7c3aed' : 'rgba(255,255,255,0.15)'}`,
              borderRadius: '14px', cursor: 'pointer',
              background: uploadedFile ? 'rgba(124,58,237,0.08)' : 'rgba(255,255,255,0.02)',
              transition: 'all 0.2s'
            }}>
              {uploadedFile ? (
                <>
                  <div style={{ fontSize: '1.5rem', marginBottom: '6px' }}>✓</div>
                  <div style={{ fontSize: '0.9rem', color: '#a78bfa', fontWeight: '600' }}>
                    {uploadedFile.name}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#666', marginTop: '4px' }}>
                    Click to choose a different file
                  </div>
                </>
              ) : (
                <>
                  <div style={{ fontSize: '2rem', marginBottom: '8px' }}>📁</div>
                  <div style={{ fontSize: '0.95rem', color: '#ccc', fontWeight: '600' }}>
                    Click here to upload
                  </div>
                  <div style={{ fontSize: '0.78rem', color: '#555', marginTop: '4px' }}>
                    {selectedPlatform === 'chatgpt' ? '.zip file from your email' : 'conversations.json'}
                  </div>
                </>
              )}
              <input
                type="file"
                accept=".json,.zip"
                style={{ display: 'none' }}
                onChange={e => {
                  setError('')
                  handleSingleFileUpload(e.target.files[0])
                }}
              />
            </label>
          </div>

          <input
            type="email"
            placeholder="Your email (same one you used in the extension)"
            value={email}
            onChange={e => setEmail(e.target.value)}
            onBlur={e => checkExistingData(e.target.value)}
            style={{
              width: '100%', padding: '14px 16px',
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: '10px', color: 'white',
              fontSize: '0.9rem', marginBottom: '12px', outline: 'none'
            }}
          />

          {checkingEmail && (
            <div style={{ fontSize: '0.78rem', color: '#555', marginBottom: '12px', textAlign: 'center' }}>
              Checking your account...
            </div>
          )}

          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            style={{
              background: 'none', border: 'none', color: '#555',
              fontSize: '0.75rem', cursor: 'pointer', marginBottom: '12px', padding: 0
            }}
          >
            {showAdvanced ? '▾ Hide advanced settings' : '▸ Advanced settings (optional)'}
          </button>

          {showAdvanced && (
            <input
              type="password"
              placeholder="Anthropic API key (only if import fails)"
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              style={{
                width: '100%', padding: '14px 16px',
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '10px', color: 'white',
                fontSize: '0.85rem', marginBottom: '16px', outline: 'none'
              }}
            />
          )}

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
            onClick={handleGenerate}
            disabled={!canGenerate}
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
            {hasFile ? '🌍 Import & build my map' : '🌍 Open my map'}
          </button>

          <p style={{
            textAlign: 'center', color: '#444',
            fontSize: '0.75rem', marginTop: '16px', lineHeight: '1.5'
          }}>
            Your chats stay private. Only you can see them.
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
          maps your entire AI history on a 2D canvas, and engineers better prompts from your own past.
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

      <footer style={{
        textAlign: 'center',
        padding: '24px',
        color: '#444',
        fontSize: '0.8rem',
        borderTop: '1px solid rgba(255,255,255,0.05)',
        marginTop: '40px'
      }}>
        <a href="/privacy" style={{ color: '#666', textDecoration: 'none' }}>Privacy Policy</a>
        {' · '}
        <a href="/terms" style={{ color: '#666', textDecoration: 'none' }}>Terms of Service</a>
        {' · '}
        © 2026 Mind World
      </footer>
    </div>
  )
}
