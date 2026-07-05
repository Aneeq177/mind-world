import { useEffect, useLayoutEffect } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { useStore } from './store'
import { fetchAuthAccount } from './api'
import { resolveDashboardAfterSignIn } from './postAuth'
import Landing from './components/Landing'
import MapView from './components/MapView'
import PasswordSetup from './components/PasswordSetup'
import Privacy from './components/Privacy'
import Terms from './components/Terms'
import AuthCallback from './components/AuthCallback'

function MainApp() {
  const phase = useStore(s => s.phase)
  const setPhase = useStore(s => s.setPhase)
  const setConversations = useStore(s => s.setConversations)
  const setCredentials = useStore(s => s.setCredentials)

  useLayoutEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('postAuth') !== 'true') return
    if (!sessionStorage.getItem('mw_email') || !sessionStorage.getItem('mw_access_token')) return
    sessionStorage.setItem('mw_post_auth', '1')
    setPhase('processing')
  }, [setPhase])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('postAuth') !== 'true') return

    window.history.replaceState({}, '', window.location.pathname)

    let cancelled = false
    ;(async () => {
      const result = await resolveDashboardAfterSignIn({
        setPhase,
        setConversations,
        setCredentials
      })
      if (cancelled) return
      sessionStorage.removeItem('mw_post_auth')
      if (result.destination === 'upload') {
        window.history.replaceState({}, '', '/?view=upload')
      }
    })()

    return () => { cancelled = true }
  }, [setPhase, setConversations, setCredentials])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('postAuth') === 'true') return

    const email = sessionStorage.getItem('mw_email')
    const token = sessionStorage.getItem('mw_access_token')
    if (!email || !token) return

    // If a fresh Google login just set the needs_password flag, honour it immediately
    // without waiting for the async /auth/account call.
    const needsPasswordFlag = sessionStorage.getItem('mw_needs_password')
    if (needsPasswordFlag === '1') {
      sessionStorage.removeItem('mw_needs_password')
      setPhase('password-setup')
      return
    }

    let cancelled = false
    ;(async () => {
      try {
        const account = await fetchAuthAccount({ email, accessToken: token })
        if (cancelled || !account || account.has_password) return
        setPhase('password-setup')
      } catch (err) {
        console.error('[MindWorld] Could not verify password status on load:', err)
      }
    })()

    return () => { cancelled = true }
  }, [setPhase])

  useEffect(() => {
    const lockScroll = phase === 'map'
    document.body.style.overflow = lockScroll ? 'hidden' : ''
    document.documentElement.style.overflow = lockScroll ? 'hidden' : ''
    return () => {
      document.body.style.overflow = ''
      document.documentElement.style.overflow = ''
    }
  }, [phase])

  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative' }}>
      {phase === 'password-setup' && <PasswordSetup />}
      {(phase === 'landing' || phase === 'processing') && <Landing />}
      {phase === 'map' && <MapView />}
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<MainApp />} />
        <Route path="/auth/callback" element={<AuthCallback />} />
        <Route path="/privacy" element={<Privacy />} />
        <Route path="/terms" element={<Terms />} />
      </Routes>
    </BrowserRouter>
  )
}
