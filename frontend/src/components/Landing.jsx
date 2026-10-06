import { useState, useEffect } from 'react'
import { useStore } from '../store'
import { processFiles, loadExistingMap, recordConsent, ensureAccessToken, login, register } from '../api'
import MarketingHome from './MarketingHome'

const CHROME_STORE_URL =
  'https://chromewebstore.google.com/detail/mind-world/dcbicejbdecfpdjgmnclmafiobgomhdp?utm_source=item'
const CONSENT_VERSION = '2026-06-2'

const UPLOAD_CONSENT_LABEL = (
  <>
    I agree to Mind World processing my uploaded AI chat exports and account data as described in the{' '}
    <a href="/privacy" target="_blank" rel="noreferrer" style={{ color: 'var(--accent-text)' }}>
      Privacy Policy
    </a>{' '}
    and{' '}
    <a href="/terms" target="_blank" rel="noreferrer" style={{ color: 'var(--accent-text)' }}>
      Terms of Service
    </a>
    , including:
    <ul style={{ margin: '8px 0 0', paddingLeft: '18px', lineHeight: 1.55 }}>
      <li>Using my email to identify my account</li>
      <li>Storing conversation text on Mind World servers</li>
      <li>Creating semantic embeddings for search and memory</li>
      <li>Optional AI topic labeling via Anthropic during import</li>
      <li>
        Storing Improve feedback metrics in <code style={{ fontSize: '0.85em', color: 'var(--text-muted)' }}>prompt_feedback</code>{' '}
        (edit distance, hashes, and goal text up to 500 characters) when I use the extension
      </li>
      <li>Optional personal profile and inference from my conversations when profile is enabled</li>
    </ul>
  </>
)

const LOADING_MESSAGES = [
  'Reading your conversations...',
  'Generating embeddings...',
  'Mapping your conversations in 2D...',
  'Identifying your topics...',
  'Building your map...'
]

const inputStyle = {
  width: '100%', padding: '13px 14px',
  background: 'var(--bg)',
  border: '1px solid var(--border-strong)',
  borderRadius: '8px', color: 'var(--text)',
  fontSize: '0.9rem', marginBottom: '12px', outline: 'none',
  fontFamily: 'inherit'
}

const stepLabelStyle = {
  fontSize: '0.75rem', color: 'var(--text-subtle)', marginBottom: '10px',
  fontWeight: '600', letterSpacing: '0.04em', textTransform: 'uppercase'
}

function LogoMark({ size = 28 }) {
  return (
    <span style={{
      width: size, height: size, borderRadius: size / 4,
      background: 'var(--accent)', color: '#fff',
      display: 'inline-grid', placeItems: 'center',
      fontSize: size * 0.48, fontWeight: 800
    }}>
      M
    </span>
  )
}

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

  function handleSignOut() {
    sessionStorage.removeItem('mw_email')
    sessionStorage.removeItem('mw_access_token')
    setSignedIn(false)
    setHasExistingData(false)
    setExistingCount(0)
    setPassword('')
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
    if (!['.zip', '.json', '.jsonl'].some(ext => name.endsWith(ext))) {
      setError('Please upload the .zip file you downloaded from Claude or ChatGPT.')
      return
    }
    // The server detects Claude vs ChatGPT from the file contents, so the field is just a label.
    if (selectedPlatform === 'claude') {
      setClaudeFile(file)
      setChatgptFile(null)
    } else {
      setChatgptFile(file)
      setClaudeFile(null)
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
        background: 'var(--bg)', color: 'var(--text)', gap: '24px'
      }}>
        <LogoMark size={48} />
        <div style={{ fontSize: '1.05rem', color: 'var(--text-muted)', minHeight: '2rem', textAlign: 'center' }}>
          {loadingMsg}
        </div>
        <div style={{
          width: '200px', height: '3px',
          background: 'var(--surface-2)',
          borderRadius: '2px', overflow: 'hidden'
        }}>
          <div style={{
            height: '100%', background: 'var(--accent)',
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
      'Claude emails you download links — download the file named conversations (a .zip)',
      'Upload that .zip below — no need to unzip it'
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
        background: 'var(--bg)'
      }}>
        <div style={{
          width: '520px', maxWidth: '100%', padding: '36px',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: '16px', color: 'var(--text)'
        }}>
          <button
            onClick={() => setView('home')}
            style={{
              background: 'none', border: 'none', color: 'var(--text-muted)',
              fontSize: '0.85rem', cursor: 'pointer', marginBottom: '20px',
              padding: 0, display: 'flex', alignItems: 'center', gap: '4px'
            }}
          >
            ← Back
          </button>

          <div style={{ textAlign: 'center', marginBottom: '28px' }}>
            <div style={{ marginBottom: '14px' }}><LogoMark size={40} /></div>
            <h1 style={{ fontSize: '1.5rem', fontWeight: '700', marginBottom: '8px', letterSpacing: '-0.01em' }}>
              Import your AI chats
            </h1>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', lineHeight: '1.6' }}>
              One-time setup that takes about 2 minutes. Imported chats are stored in your
              cloud account and power the conversation map.
            </p>
          </div>

          {hasExistingData && !checkingEmail && (
            <div style={{
              background: 'var(--accent-soft)',
              border: '1px solid var(--accent-border)',
              borderRadius: '10px',
              padding: '14px 16px',
              marginBottom: '20px'
            }}>
              <div style={{ color: 'var(--accent-text)', fontWeight: '600', marginBottom: '4px' }}>
                You already have {existingCount} conversations saved
              </div>
              <button
                onClick={handleLoadExisting}
                style={{
                  width: '100%', padding: '12px', marginTop: '8px',
                  background: 'var(--accent)',
                  border: 'none', borderRadius: '8px',
                  color: 'white', fontSize: '0.9rem', fontWeight: '600',
                  cursor: 'pointer'
                }}
              >
                Open my map →
              </button>
              <div style={{ color: 'var(--text-subtle)', fontSize: '0.75rem', textAlign: 'center', marginTop: '8px' }}>
                or add more chats below
              </div>
            </div>
          )}

          {/* Step 1: Which AI? */}
          <div style={{ marginBottom: '20px' }}>
            <div style={stepLabelStyle}>Step 1 — Which AI do you use?</div>
            <div style={{ display: 'flex', gap: '10px' }}>
              {[
                { id: 'chatgpt', label: 'ChatGPT' },
                { id: 'claude', label: 'Claude' }
              ].map(p => (
                <button
                  key={p.id}
                  onClick={() => setSelectedPlatform(p.id)}
                  style={{
                    flex: 1, padding: '13px',
                    borderRadius: '8px', cursor: 'pointer',
                    border: selectedPlatform === p.id
                      ? '1px solid var(--accent-border)'
                      : '1px solid var(--border-strong)',
                    background: selectedPlatform === p.id ? 'var(--accent-soft)' : 'transparent',
                    color: selectedPlatform === p.id ? 'var(--text)' : 'var(--text-muted)',
                    fontSize: '0.9rem', fontWeight: '600'
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Step 2: How to download */}
          <div style={{
            marginBottom: '20px', padding: '16px',
            background: 'var(--bg)',
            border: '1px solid var(--border)',
            borderRadius: '10px'
          }}>
            <div style={stepLabelStyle}>Step 2 — Download your chats</div>
            <ol style={{ margin: 0, paddingLeft: '20px', fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: '1.7' }}>
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
            background: uploadConsent ? 'var(--accent-soft)' : 'transparent',
            border: uploadConsent
              ? '1px solid var(--accent-border)'
              : '1px solid var(--border)',
            borderRadius: '10px',
            cursor: 'pointer',
            fontSize: '0.82rem',
            color: 'var(--text-muted)',
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
              style={{ marginTop: '3px', flexShrink: 0, accentColor: 'var(--accent)' }}
            />
            <span>{UPLOAD_CONSENT_LABEL}</span>
          </label>

          {/* Step 3: Upload */}
          <div style={{ marginBottom: '16px' }}>
            <div style={stepLabelStyle}>Step 3 — Upload the file</div>
            <label style={{
              display: 'block', padding: '28px 20px', textAlign: 'center',
              border: `2px dashed ${uploadedFile ? 'var(--accent)' : 'var(--border-strong)'}`,
              borderRadius: '12px',
              cursor: uploadConsent ? 'pointer' : 'not-allowed',
              opacity: uploadConsent ? 1 : 0.55,
              background: uploadedFile ? 'var(--accent-soft)' : 'transparent',
              transition: 'all 0.2s'
            }}>
              {uploadedFile ? (
                <>
                  <div style={{ fontSize: '0.9rem', color: 'var(--accent-text)', fontWeight: '600' }}>
                    {uploadedFile.name}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-subtle)', marginTop: '4px' }}>
                    Click to choose a different file
                  </div>
                </>
              ) : (
                <>
                  <div style={{ fontSize: '0.95rem', color: 'var(--text)', fontWeight: '600' }}>
                    Click to upload
                  </div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-subtle)', marginTop: '4px' }}>
                    {selectedPlatform === 'chatgpt' ? '.zip file from your email' : 'conversations .zip from your email'}
                  </div>
                </>
              )}
              <input
                type="file"
                accept=".zip,.json,.jsonl"
                disabled={!uploadConsent}
                style={{ display: 'none' }}
                onChange={e => {
                  setError('')
                  handleSingleFileUpload(e.target.files[0])
                }}
              />
            </label>
            {!uploadConsent && (
              <div style={{ fontSize: '0.75rem', color: 'var(--text-subtle)', marginTop: '8px', textAlign: 'center' }}>
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
            style={{ ...inputStyle, opacity: signedIn ? 0.7 : 1 }}
          />

          {!signedIn ? (
            <>
              <input
                type="password"
                placeholder="Password (8+ characters)"
                value={password}
                onChange={e => setPassword(e.target.value)}
                style={inputStyle}
              />
              <button
                type="button"
                onClick={handlePasswordAuth}
                disabled={authLoading}
                style={{
                  width: '100%', padding: '13px',
                  background: 'var(--accent)',
                  border: 'none', borderRadius: '8px',
                  color: 'white', fontWeight: 600, cursor: 'pointer',
                  marginBottom: '10px', fontSize: '0.92rem'
                }}
              >
                {authLoading ? 'Please wait…' : (isRegisterMode ? 'Create account' : 'Sign in')}
              </button>
              <button
                type="button"
                onClick={() => setIsRegisterMode(v => !v)}
                style={{
                  width: '100%', background: 'none', border: 'none',
                  color: 'var(--text-muted)', fontSize: '0.82rem', cursor: 'pointer',
                  marginBottom: '12px'
                }}
              >
                {isRegisterMode ? 'Already have an account? Sign in' : 'New here? Create an account'}
              </button>
            </>
          ) : (
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              marginBottom: '12px', fontSize: '0.82rem', color: 'var(--success)'
            }}>
              <span>Signed in as {email}</span>
              <button
                type="button"
                onClick={handleSignOut}
                style={{ background: 'none', border: 'none', color: 'var(--accent-text)', cursor: 'pointer' }}
              >
                Sign out
              </button>
            </div>
          )}

          {checkingEmail && (
            <div style={{ fontSize: '0.78rem', color: 'var(--text-subtle)', marginBottom: '12px', textAlign: 'center' }}>
              Checking your account...
            </div>
          )}

          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            style={{
              background: 'none', border: 'none', color: 'var(--text-subtle)',
              fontSize: '0.78rem', cursor: 'pointer', marginBottom: '12px', padding: 0
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
              style={{ ...inputStyle, fontSize: '0.85rem', marginBottom: '16px' }}
            />
          )}

          {error && (
            <div style={{
              padding: '12px',
              background: 'rgba(248,113,113,0.1)',
              border: '1px solid rgba(248,113,113,0.35)',
              borderRadius: '8px', color: 'var(--danger)',
              fontSize: '0.85rem', marginBottom: '16px'
            }}>
              {error}
            </div>
          )}

          <button
            onClick={handleGenerate}
            disabled={!canUpload}
            style={{
              width: '100%', padding: '15px',
              background: canUpload ? 'var(--accent)' : 'var(--surface-2)',
              border: 'none', borderRadius: '8px',
              color: canUpload ? 'white' : 'var(--text-subtle)',
              fontSize: '0.98rem', fontWeight: '600',
              cursor: canUpload ? 'pointer' : 'not-allowed',
              transition: 'all 0.2s'
            }}
          >
            {hasFile ? 'Import & build my map' : 'Open my map'}
          </button>

          <p style={{
            textAlign: 'center', color: 'var(--text-subtle)',
            fontSize: '0.75rem', marginTop: '16px', lineHeight: '1.5'
          }}>
            Your chats are private to your account.{' '}
            <a href="/privacy" style={{ color: 'var(--text-muted)' }}>Privacy Policy</a>
            {' · '}
            <a href="/terms" style={{ color: 'var(--text-muted)' }}>Terms of Service</a>
          </p>
        </div>
      </div>
    )
  }

  return <MarketingHome chromeStoreUrl={CHROME_STORE_URL} onImport={() => setView('upload')} />
}
