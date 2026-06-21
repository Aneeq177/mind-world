import { useState, useEffect } from 'react'
import { useStore } from '../store'
import { processFiles, loadExistingMap, recordConsent, ensureAccessToken, login, register, getGoogleSignInUrl } from '../api'

const CHROME_STORE_URL = 'https://chrome.google.com/webstore/detail/mind-world'
const CONSENT_VERSION = '2026-06-2'

const UPLOAD_CONSENT_LABEL = (
  <>
    I agree to Mind World processing my uploaded AI chat exports and account data as described in the{' '}
    <a href="/privacy" target="_blank" rel="noreferrer" style={{ color: '#a78bfa' }}>
      Privacy Policy
    </a>{' '}
    and{' '}
    <a href="/terms" target="_blank" rel="noreferrer" style={{ color: '#a78bfa' }}>
      Terms of Service
    </a>
    , including:
    <ul style={{ margin: '8px 0 0', paddingLeft: '18px', lineHeight: 1.55 }}>
      <li>Using my email to identify my account</li>
      <li>Storing conversation text on Mind World servers</li>
      <li>Creating semantic embeddings for search and memory</li>
      <li>Optional AI topic labeling via Anthropic during import</li>
      <li>
        Storing Improve feedback metrics in <code style={{ fontSize: '0.85em', color: '#999' }}>prompt_feedback</code>{' '}
        (edit distance, hashes, and goal text up to 500 characters) when I use the extension
      </li>
      <li>Optional personal profile and inference from my conversations when profile is enabled</li>
      <li>Team workspace sharing only when I explicitly mark conversations as team-visible</li>
    </ul>
  </>
)

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
  const [uploadConsent, setUploadConsent] = useState(false)
  const [password, setPassword] = useState('')
  const [isRegisterMode, setIsRegisterMode] = useState(false)
  const [signedIn, setSignedIn] = useState(false)
  const [authLoading, setAuthLoading] = useState(false)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const emailParam = params.get('email')
    const viewParam = params.get('view')
    const storedEmail = sessionStorage.getItem('mw_email') || ''
    const storedToken = sessionStorage.getItem('mw_access_token') || ''

    if (emailParam) {
      setEmail(emailParam)
    }
    if (emailParam || viewParam === 'upload') {
      setView('upload')
    }

    // Post-sign-in dashboard bootstrap runs in App.jsx
    if (params.get('postAuth') === 'true') return

    if (!storedEmail || !storedToken) return

    setEmail(storedEmail)
    setSignedIn(true)

    let cancelled = false
    ;(async () => {
      setCheckingEmail(true)
      try {
        const mapData = await loadExistingMap({ email: storedEmail, accessToken: storedToken })
        if (cancelled) return
        if (mapData.has_data && mapData.total > 0) {
          setHasExistingData(true)
          setExistingCount(mapData.total)
        } else {
          setHasExistingData(false)
          setExistingCount(0)
        }
      } catch {
        if (!cancelled) setHasExistingData(false)
      } finally {
        if (!cancelled) setCheckingEmail(false)
      }
    })()

    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (phase === 'processing' && sessionStorage.getItem('mw_post_auth') === '1') {
      setLoadingMsg('Loading your dashboard...')
    }
  }, [phase])

  useEffect(() => {
    if (phase !== 'landing') return

    const params = new URLSearchParams(window.location.search)
    if (params.get('view') === 'upload') {
      setView('upload')
    }

    const storedEmail = sessionStorage.getItem('mw_email') || ''
    const storedToken = sessionStorage.getItem('mw_access_token') || ''
    if (!storedEmail || !storedToken || signedIn) return

    setEmail(storedEmail)
    setSignedIn(true)
  }, [phase, signedIn])

  async function persistSession(emailValue, accessToken) {
    sessionStorage.setItem('mw_email', emailValue)
    sessionStorage.setItem('mw_access_token', accessToken)
    setEmail(emailValue)
    setSignedIn(true)
    setCredentials(emailValue, apiKey || '')
  }

  async function handlePasswordAuth() {
    setError('')
    if (!email || !email.includes('@')) {
      setError('Please enter a valid email.')
      return
    }
    if (!password || password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (hasFile && !uploadConsent) {
      setError('Please acknowledge the data processing notice first.')
      return
    }

    setAuthLoading(true)
    try {
      const data = isRegisterMode
        ? await register({ email, password })
        : await login({ email, password })
      await persistSession(data.email || email, data.access_token)
      if (hasFile || isRegisterMode) {
        await recordConsent({
          email: data.email || email,
          accessToken: data.access_token,
          consentVersion: CONSENT_VERSION,
          source: 'web_app'
        })
      }
      await checkExistingData(data.email || email)
    } catch (err) {
      setError(err.message || 'Sign in failed')
    } finally {
      setAuthLoading(false)
    }
  }

  function handleGoogleAuth() {
    window.location.href = getGoogleSignInUrl('web')
  }

  function handleSignOut() {
    sessionStorage.removeItem('mw_email')
    sessionStorage.removeItem('mw_access_token')
    setSignedIn(false)
    setHasExistingData(false)
    setExistingCount(0)
    setPassword('')
  }

  async function autoLoadMap(emailValue) {
    setError('')
    setLoadingMsg('Loading your map...')
    setPhase('processing')
    try {
      const token = await ensureAccessToken(emailValue)
      const data = await loadExistingMap({ email: emailValue, accessToken: token })
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
    if (!signedIn && !sessionStorage.getItem('mw_access_token')) return
    setCheckingEmail(true)
    try {
      const token = await ensureAccessToken(emailValue)
      const data = await loadExistingMap({ email: emailValue, accessToken: token })
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
    if (!email || !signedIn) {
      setError('Sign in to load your saved map.')
      return
    }
    setError('')
    setLoadingMsg('Loading your map...')
    setPhase('processing')
    try {
      const token = await ensureAccessToken(email)
      const data = await loadExistingMap({ email, accessToken: token })
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
    if (!uploadConsent) {
      setError('Please acknowledge the data processing notice before uploading your chats.')
      return
    }
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
  const canGenerate = signedIn && email && email.includes('@') && (hasFile || hasExistingData)
  const canUpload = canGenerate && (!hasFile || uploadConsent)

  async function handleGenerate() {
    if (!canGenerate) return
    // If no new files but existing data, just load from DB
    if (!claudeFile && !chatgptFile && hasExistingData) {
      return handleLoadExisting()
    }
    if (!signedIn) {
      setError('Sign in to continue.')
      return
    }
    if (!email.includes('@') || !email.includes('.')) {
      setError('Please enter a valid email address.')
      return
    }
    if (hasFile && !uploadConsent) {
      setError('Please acknowledge the data processing notice to import your chats.')
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
      const token = await ensureAccessToken(email)
      if (hasFile) {
        await recordConsent({
          email,
          accessToken: token,
          consentVersion: CONSENT_VERSION,
          source: 'web_app'
        })
      }
      const data = await processFiles({
        claudeFile,
        chatgptFile,
        apiKey,
        email,
        accessToken: token
      })
      if (data.access_token) {
        sessionStorage.setItem('mw_access_token', data.access_token)
      }
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
        width: '100vw',
        height: '100vh',
        overflowY: 'auto',
        overflowX: 'hidden',
        WebkitOverflowScrolling: 'touch',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        padding: '32px 24px 48px',
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

          {/* Consent — required before upload (informed consent at collection) */}
          <label style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: '10px',
            marginBottom: '20px',
            padding: '14px',
            background: uploadConsent ? 'rgba(124,58,237,0.06)' : 'rgba(255,255,255,0.02)',
            border: uploadConsent
              ? '1px solid rgba(124,58,237,0.35)'
              : '1px solid rgba(255,255,255,0.08)',
            borderRadius: '10px',
            cursor: 'pointer',
            fontSize: '0.82rem',
            color: '#aaa',
            lineHeight: '1.55'
          }}>
            <input
              type="checkbox"
              checked={uploadConsent}
              onChange={e => {
                const checked = e.target.checked
                setUploadConsent(checked)
                if (checked) {
                  setError('')
                } else {
                  setClaudeFile(null)
                  setChatgptFile(null)
                }
              }}
              style={{ marginTop: '3px', flexShrink: 0 }}
            />
            <span>{UPLOAD_CONSENT_LABEL}</span>
          </label>

          {/* Step 3: Upload */}
          <div style={{ marginBottom: '16px' }}>
            <div style={{ fontSize: '0.75rem', color: '#666', marginBottom: '10px', fontWeight: '600' }}>
              STEP 3 — Upload the file
            </div>
            <label style={{
              display: 'block', padding: '28px 20px', textAlign: 'center',
              border: `2px dashed ${uploadedFile ? '#7c3aed' : 'rgba(255,255,255,0.15)'}`,
              borderRadius: '14px',
              cursor: uploadConsent ? 'pointer' : 'not-allowed',
              opacity: uploadConsent ? 1 : 0.55,
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
                disabled={!uploadConsent}
                style={{ display: 'none' }}
                onChange={e => {
                  setError('')
                  handleSingleFileUpload(e.target.files[0])
                }}
              />
            </label>
            {!uploadConsent && (
              <div style={{ fontSize: '0.75rem', color: '#666', marginTop: '8px', textAlign: 'center' }}>
                Acknowledge the data processing notice above to enable upload.
              </div>
            )}
          </div>

          <input
            type="email"
            placeholder="Your email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            onBlur={e => checkExistingData(e.target.value)}
            disabled={signedIn}
            style={{
              width: '100%', padding: '14px 16px',
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: '10px', color: 'white',
              fontSize: '0.9rem', marginBottom: '12px', outline: 'none',
              opacity: signedIn ? 0.7 : 1
            }}
          />

          {!signedIn ? (
            <>
              <input
                type="password"
                placeholder="Password (8+ characters)"
                value={password}
                onChange={e => setPassword(e.target.value)}
                style={{
                  width: '100%', padding: '14px 16px',
                  background: 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: '10px', color: 'white',
                  fontSize: '0.9rem', marginBottom: '12px', outline: 'none'
                }}
              />
              <button
                type="button"
                onClick={handlePasswordAuth}
                disabled={authLoading}
                style={{
                  width: '100%', padding: '14px',
                  background: 'linear-gradient(135deg, #7c3aed, #5b21b6)',
                  border: 'none', borderRadius: '10px',
                  color: 'white', fontWeight: 600, cursor: 'pointer',
                  marginBottom: '10px'
                }}
              >
                {authLoading ? 'Please wait…' : (isRegisterMode ? 'Create account' : 'Sign in')}
              </button>
              <button
                type="button"
                onClick={handleGoogleAuth}
                style={{
                  width: '100%', padding: '14px',
                  background: 'white', border: 'none', borderRadius: '10px',
                  color: '#333', fontWeight: 600, cursor: 'pointer',
                  marginBottom: '10px'
                }}
              >
                Continue with Google
              </button>
              <button
                type="button"
                onClick={() => setIsRegisterMode(v => !v)}
                style={{
                  width: '100%', background: 'none', border: 'none',
                  color: '#888', fontSize: '0.8rem', cursor: 'pointer',
                  marginBottom: '12px'
                }}
              >
                {isRegisterMode ? 'Already have an account? Sign in' : 'New here? Create an account'}
              </button>
            </>
          ) : (
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              marginBottom: '12px', fontSize: '0.82rem', color: '#8b8'
            }}>
              <span>Signed in as {email}</span>
              <button
                type="button"
                onClick={handleSignOut}
                style={{ background: 'none', border: 'none', color: '#a78bfa', cursor: 'pointer' }}
              >
                Sign out
              </button>
            </div>
          )}

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
              placeholder="Anthropic API key (optional — for Improve and import labeling)"
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
            disabled={!canUpload}
            style={{
              width: '100%', padding: '16px',
              background: canUpload
                ? 'linear-gradient(135deg, #7c3aed, #5b21b6)'
                : 'rgba(255,255,255,0.05)',
              border: 'none', borderRadius: '12px',
              color: canUpload ? 'white' : '#555',
              fontSize: '1rem', fontWeight: '600',
              cursor: canUpload ? 'pointer' : 'not-allowed',
              transition: 'all 0.2s'
            }}
          >
            {hasFile ? '🌍 Import & build my map' : '🌍 Open my map'}
          </button>

          <p style={{
            textAlign: 'center', color: '#444',
            fontSize: '0.75rem', marginTop: '16px', lineHeight: '1.5'
          }}>
            Your chats stay private. Only you can see them.{' '}
            <a href="/privacy" style={{ color: '#666' }}>Privacy Policy</a>
            {' · '}
            <a href="/terms" style={{ color: '#666' }}>Terms of Service</a>
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
