import { loadExistingMap } from './api'

/** After sign-in, load saved conversations and open the map dashboard when available. */
export async function resolveDashboardAfterSignIn({ setPhase, setConversations, setCredentials, apiKey = '' }) {
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
