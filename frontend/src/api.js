const BASE_URL = import.meta.env.VITE_API_URL || 'https://mind-world-app-mv4yv.ondigitalocean.app'

export async function processFiles({ claudeFile, chatgptFile, apiKey }) {
  const formData = new FormData()

  if (claudeFile) formData.append('claude_file', claudeFile)
  if (chatgptFile) formData.append('chatgpt_file', chatgptFile)
  formData.append('api_key', apiKey)

  const response = await fetch(`${BASE_URL}/process`, {
    method: 'POST',
    body: formData
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.detail || 'Processing failed')
  }

  return response.json()
}

export async function healthCheck() {
  const response = await fetch(`${BASE_URL}/health`)
  return response.json()
}
