import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'

export default function AuthCallback() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const [message, setMessage] = useState('Signing you in…')

  useEffect(() => {
    const error = searchParams.get('error')
    const accessToken = searchParams.get('access_token')
    const email = searchParams.get('email')
    const source = searchParams.get('source')

    if (error) {
      setMessage(`Sign-in failed: ${error}`)
      return
    }

    if (!accessToken || !email) {
      setMessage('Sign-in incomplete. Close this tab and try again.')
      return
    }

    sessionStorage.setItem('mw_access_token', accessToken)
    sessionStorage.setItem('mw_email', email)

    if (source === 'extension') {
      setMessage('Success! You can close this tab and return to the Mind World extension.')
      return
    }

    navigate('/?view=upload&autoLoad=true', { replace: true })
  }, [navigate, searchParams])

  return (
    <div style={{
      width: '100vw',
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#000008',
      color: 'white',
      padding: '24px',
      textAlign: 'center'
    }}>
      <div>
        <div style={{ fontSize: '2.5rem', marginBottom: '16px' }}>🌍</div>
        <p style={{ color: '#aaa', lineHeight: 1.6, maxWidth: '360px' }}>{message}</p>
      </div>
    </div>
  )
}
