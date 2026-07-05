import { fetchAuthAccount, loadExistingMap } from './api'

/** Load saved conversations and open the map dashboard when available. */
export async function openDashboard({ setPhase, setConversations, setCredentials, apiKey = '' }) {
  const email = sessionStorage.getItem('mw_email') || ''
  const token = sessionStorage.getItem('mw_access_token') || ''
  if (!email || !token) {
    setPhase('landing')
    return { destination: 'upload' }
  }

  setPhase('processing')
  try {
    const mapData = await loadExistingMap({ email, accessToken: token })
    setCredentials(email, apiKey)
    if (mapData.has_data && mapData.total > 0) {
      setConversations(mapData.conversations, mapData.sources)
      setPhase('map')
      return { destination: 'map', total: mapData.total }
    }
    setPhase('landing')
    return { destination: 'upload' }
  } catch {
    setPhase('landing')
    return { destination: 'upload' }
  }
}

/** After sign-in, require a password for Google accounts, then open the dashboard. */
export async function resolveDashboardAfterSignIn({ setPhase, setConversations, setCredentials, apiKey = '' }) {
  const email = sessionStorage.getItem('mw_email') || ''
  const token = sessionStorage.getItem('mw_access_token') || ''
  if (!email || !token) {
    setPhase('landing')
    return { destination: 'upload' }
  }

  // Fast path: backend told us whether a password is needed via the OAuth redirect URL.
  // This avoids an extra /auth/account round-trip that could silently fail.
  const needsPasswordFlag = sessionStorage.getItem('mw_needs_password')
  if (needsPasswordFlag === '1') {
    sessionStorage.removeItem('mw_needs_password')
    setPhase('password-setup')
    return { destination: 'password-setup' }
  }
  if (needsPasswordFlag === '0') {
    sessionStorage.removeItem('mw_needs_password')
    return await openDashboard({ setPhase, setConversations, setCredentials, apiKey })
  }

  // Fallback: flag not present (e.g. old redirect or direct navigation) — ask the server.
  setPhase('processing')
  try {
    const account = await fetchAuthAccount({ email, accessToken: token })
    if (!account.has_password) {
      setPhase('password-setup')
      return { destination: 'password-setup' }
    }
    return await openDashboard({ setPhase, setConversations, setCredentials, apiKey })
  } catch (err) {
    console.error('[MindWorld] Could not check account password status:', err)
    setPhase('landing')
    return { destination: 'upload' }
  }
}
