const BASE_URL = import.meta.env.VITE_API_URL || 'https://mind-world-app-mv4yv.ondigitalocean.app'

export async function processFiles({ claudeFile, chatgptFile, apiKey, email }) {
  const formData = new FormData()

  if (claudeFile) formData.append('claude_file', claudeFile)
  if (chatgptFile) formData.append('chatgpt_file', chatgptFile)
  formData.append('api_key', apiKey)
  formData.append('email', email)

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

export async function loadExistingMap(email) {
  const response = await fetch(`${BASE_URL}/load_map`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email })
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error(error.detail || 'Failed to load map')
  }

  return response.json()
}

export async function healthCheck() {
  const response = await fetch(`${BASE_URL}/health`)
  return response.json()
}

export async function searchConversations({ email, query }) {
  const response = await fetch(`${BASE_URL}/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, query })
  })
  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error(error.detail || 'Search failed')
  }
  return response.json()
}

export async function engineerPrompt({ email, message, conversationIds }) {
  const response = await fetch(`${BASE_URL}/engineer_prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
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
