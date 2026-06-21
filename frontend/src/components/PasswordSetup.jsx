import { useState } from 'react'
import { useStore } from '../store'
import { ensureAccessToken, setAccountPassword } from '../api'
import { openDashboard } from '../postAuth'

export default function PasswordSetup() {
  const setPhase = useStore(s => s.setPhase)
  const setConversations = useStore(s => s.setConversations)
  const setCredentials = useStore(s => s.setCredentials)

  const email = sessionStorage.getItem('mw_email') || ''
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  function handleSignOut() {
    sessionStorage.removeItem('mw_email')
    sessionStorage.removeItem('mw_access_token')
    sessionStorage.removeItem('mw_post_auth')
    setPhase('landing')
    window.history.replaceState({}, '', '/')
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    if (!newPassword || newPassword.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }

    setLoading(true)
    try {
      const token = await ensureAccessToken(email)
      await setAccountPassword({ email, accessToken: token, password: newPassword })
      const result = await openDashboard({ setPhase, setConversations, setCredentials })
      if (result.destination === 'upload') {
        window.history.replaceState({}, '', '/?view=upload')
      }
    } catch (err) {
      setError(err.message || 'Failed to set password')
      setPhase('password-setup')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      width: '100vw',
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '32px 24px',
      boxSizing: 'border-box',
      background: '#000008',
      backgroundImage: 'radial-gradient(ellipse at center, #0a0a1a 0%, #000008 100%)',
      color: 'white'
    }}>
      <form
        onSubmit={handleSubmit}
        style={{
          width: '440px',
          maxWidth: '100%',
          padding: '40px',
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: '24px'
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: '28px' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '10px' }}>🔐</div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: '700', marginBottom: '8px' }}>
            Create your password
          </h1>
          <p style={{ color: '#888', fontSize: '0.9rem', lineHeight: 1.6, margin: 0 }}>
            You signed in with Google as <strong style={{ color: '#ccc' }}>{email}</strong>.
            A Mind World password is required so you can access your account on any device.
          </p>
        </div>

        <input
          type="password"
          placeholder="New password (8+ characters)"
          value={newPassword}
          onChange={e => setNewPassword(e.target.value)}
          autoComplete="new-password"
          required
          minLength={8}
          style={{
            width: '100%', padding: '14px 16px', boxSizing: 'border-box',
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: '10px', color: 'white',
            fontSize: '0.9rem', marginBottom: '12px', outline: 'none'
          }}
        />
        <input
          type="password"
          placeholder="Confirm password"
          value={confirmPassword}
          onChange={e => setConfirmPassword(e.target.value)}
          autoComplete="new-password"
          required
          minLength={8}
          style={{
            width: '100%', padding: '14px 16px', boxSizing: 'border-box',
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: '10px', color: 'white',
            fontSize: '0.9rem', marginBottom: '16px', outline: 'none'
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
          type="submit"
          disabled={loading}
          style={{
            width: '100%', padding: '14px',
            background: 'linear-gradient(135deg, #7c3aed, #5b21b6)',
            border: 'none', borderRadius: '10px',
            color: 'white', fontWeight: 600, cursor: loading ? 'wait' : 'pointer',
            marginBottom: '12px'
          }}
        >
          {loading ? 'Saving…' : 'Continue to Mind World'}
        </button>

        <button
          type="button"
          onClick={handleSignOut}
          style={{
            width: '100%', background: 'none', border: 'none',
            color: '#666', fontSize: '0.8rem', cursor: 'pointer'
          }}
        >
          Sign out
        </button>
      </form>
    </div>
  )
}
