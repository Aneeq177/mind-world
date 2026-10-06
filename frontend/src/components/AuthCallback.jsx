import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { exchangeGoogleHandoffCode } from '../api'

export default function AuthCallback() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const [message, setMessage] = useState('Signing you in…')

  useEffect(() => {
    let cancelled = false

    async function finishSignIn() {
      const error = searchParams.get('error')
      const code = searchParams.get('code')
      const source = searchParams.get('source')

      // Legacy redirects that still include access_token — refuse to accept them.
      if (searchParams.get('access_token')) {
        setMessage('Sign-in link is outdated. Close this tab and sign in again.')
        return
      }

      if (error) {
        setMessage(`Sign-in failed: ${error}`)
        return
      }

      if (!code) {
        setMessage('Sign-in incomplete. Close this tab and try again.')
        return
      }

      // Extension flow: background.js exchanges the one-time code. Do not consume it here.
      if (source === 'extension') {
        setMessage('Success! You can close this tab and return to the Mind World extension.')
        return
      }

      try {
        const data = await exchangeGoogleHandoffCode(code)
        if (cancelled) return

        sessionStorage.setItem('mw_access_token', data.access_token)
        sessionStorage.setItem('mw_email', data.email)

        if (data.needs_password) {
          sessionStorage.setItem('mw_needs_password', '1')
        } else {
          sessionStorage.removeItem('mw_needs_password')
        }

        navigate('/?postAuth=true', { replace: true })
      } catch (err) {
        if (cancelled) return
        setMessage(`Sign-in failed: ${err.message || 'Could not complete Google sign-in.'}`)
      }
    }

    finishSignIn()
    return () => { cancelled = true }
  }, [navigate, searchParams])

  return (
    <div style={{
      width: '100vw',
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#0b1120',
      color: 'white',
      padding: '24px',
      textAlign: 'center'
    }}>
      <div>
        <div style={{
          width: 44, height: 44, borderRadius: 11, background: 'var(--accent)', color: '#fff',
          display: 'grid', placeItems: 'center', fontSize: '1.2rem', fontWeight: 800,
          margin: '0 auto 16px'
        }}>M</div>
        <p style={{ color: '#aaa', lineHeight: 1.6, maxWidth: '360px' }}>{message}</p>
      </div>
    </div>
  )
}
