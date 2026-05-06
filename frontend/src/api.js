const BASE_URL = 'https://mind-world-app-mv4yv.ondigitalocean.app'

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
