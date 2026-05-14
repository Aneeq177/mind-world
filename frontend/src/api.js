const BASE_URL = 'https://mind-world-app-mv4yv.ondigitalocean.app'

export async function processFiles({ claudeFile, chatgptFile, apiKey, email }) {
  const formData = new FormData()

  if (claudeFile) formData.append('claude_file', claudeFile)
  if (chatgptFile) formData.append('chatgpt_file', chatgptFile)
  formData.append('api_key', apiKey)
  formData.append('email', email)

  console.log('Sending to API:', {
    claudeFile: claudeFile?.name,
    chatgptFile: chatgptFile?.name,
    email: email,
    hasApiKey: !!apiKey
  })

  const response = await fetch(`${BASE_URL}/process`, {
    method: 'POST',
    body: formData
  })

  if (!response.ok) {
    let errorDetail = 'Processing failed'
    try {
      const error = await response.json()
      if (typeof error.detail === 'string') {
        errorDetail = error.detail
      } else if (typeof error.detail === 'object') {
        errorDetail = JSON.stringify(error.detail)
      }
    } catch {
      errorDetail = `Server error: ${response.status}`
    }
    throw new Error(errorDetail)
  }

  return response.json()
}

export async function healthCheck() {
  const response = await fetch(`${BASE_URL}/health`)
  return response.json()
}

export async function blendConversations({ conversationIds, question, email, apiKey }) {
  const response = await fetch(`${BASE_URL}/blend`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      conversation_ids: conversationIds,
      question: question || '',
      email: email,
      api_key: apiKey
    })
  })
  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error(error.detail || 'Failed to blend conversations')
  }
  return response.json()
}
