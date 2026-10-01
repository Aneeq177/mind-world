const BASE_URL = import.meta.env.VITE_API_URL || 'https://mind-world-app-mv4yv.ondigitalocean.app'

export async function login({ email, password }) {
  const response = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  })
  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error(error.detail || 'Sign in failed')
  }
  return response.json()
}

export async function register({ email, password }) {
  const response = await fetch(`${BASE_URL}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  })
  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error(error.detail || 'Registration failed')
  }
  return response.json()
}

export async function exchangeGoogleHandoffCode(code) {
  const response = await fetch(`${BASE_URL}/auth/google/exchange`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code })
  })
  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error(error.detail || 'Google sign-in failed')
  }
  return response.json()
}

export async function fetchAuthAccount({ email, accessToken }) {
  const response = await fetch(`${BASE_URL}/auth/account`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, access_token: accessToken })
  })
  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error(error.detail || 'Failed to load account info')
  }
  return response.json()
}

export async function setAccountPassword({ email, accessToken, password, currentPassword }) {
  const body = { email, access_token: accessToken, password }
  if (currentPassword) body.current_password = currentPassword
  const response = await fetch(`${BASE_URL}/auth/set_password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error(error.detail || 'Failed to set password')
  }
  return response.json()
}

export async function establishSession({ email, apiKey, accessToken }) {
  const body = { email }
  if (apiKey) body.api_key = apiKey
  if (accessToken) body.access_token = accessToken
  const response = await fetch(`${BASE_URL}/auth/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error(error.detail || 'Session verification failed')
  }
  return response.json()
}

export async function ensureAccessToken(email) {
  const stored = sessionStorage.getItem('mw_access_token') || ''
  if (!stored) {
    throw new Error('Please sign in first.')
  }
  const data = await establishSession({
    email,
    accessToken: stored
  })
  sessionStorage.setItem('mw_access_token', data.access_token)
  return data.access_token
}

export async function deleteConversation({ email, accessToken, conversationId }) {
  const response = await fetch(`${BASE_URL}/delete_conversation`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      access_token: accessToken,
      conversation_id: conversationId
    })
  })
  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error(error.detail || 'Delete failed')
  }
  return response.json()
}

export async function recordConsent({ email, accessToken, consentVersion, source = 'web_app' }) {
  const response = await fetch(`${BASE_URL}/record_consent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      access_token: accessToken,
      consent_version: consentVersion,
      source
    })
  })
  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error(error.detail || 'Failed to record consent')
  }
  return response.json()
}

export async function processFiles({ claudeFile, chatgptFile, apiKey, email, accessToken }) {
  const formData = new FormData()

  if (claudeFile) formData.append('claude_file', claudeFile)
  if (chatgptFile) formData.append('chatgpt_file', chatgptFile)
  formData.append('api_key', apiKey)
  formData.append('email', email)
  if (accessToken) formData.append('access_token', accessToken)

  const response = await fetch(`${BASE_URL}/process`, {
    method: 'POST',
    body: formData
  })

  if (!response.ok) {
    let errorDetail = 'Processing failed'
    try {
      const error = await response.json()
      if (typeof error.detail === 'string') errorDetail = error.detail
      else if (typeof error.detail === 'object') errorDetail = JSON.stringify(error.detail)
    } catch {
      errorDetail = `Server error: ${response.status}`
    }
    throw new Error(errorDetail)
  }

  return response.json()
}

export async function loadExistingMap({ email, accessToken }) {
  const response = await fetch(`${BASE_URL}/load_map`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, access_token: accessToken })
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error(error.detail || 'Failed to load map')
  }

  return response.json()
}

export async function searchConversations({ email, accessToken, query }) {
  const response = await fetch(`${BASE_URL}/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, access_token: accessToken, query })
  })
  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error(error.detail || 'Search failed')
  }
  return response.json()
}

export async function engineerPrompt({ email, accessToken, message, conversationIds }) {
  const response = await fetch(`${BASE_URL}/engineer_prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      access_token: accessToken,
      message,
      conversation_ids: conversationIds && conversationIds.length > 0 ? conversationIds : null
    })
  })
  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error(error.detail || 'Failed to engineer prompt')
  }
  return response.json()
}
