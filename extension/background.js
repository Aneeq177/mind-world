const API_BASE = 'https://mind-world-app-mv4yv.ondigitalocean.app'
const USER_EMAIL = 'aneequddin66@gmail.com'

function getPlatform(url) {
  if (url.includes('claude.ai')) return 'claude'
  if (url.includes('chatgpt.com')) return 'chatgpt'
  if (url.includes('gemini.google.com')) return 'gemini'
  if (url.includes('perplexity.ai')) return 'perplexity'
  return 'unknown'
}

// Handle messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'SEARCH') {
    handleSearch(message.query).then(sendResponse)
    return true // Keep channel open for async
  }

  if (message.type === 'SAVE_CONVERSATION') {
    handleSaveConversation(message.conversation).then(sendResponse)
    return true
  }

  if (message.type === 'SUMMARIZE') {
    handleSummarize(
      message.conversationIds,
      message.currentQuery
    ).then(sendResponse)
    return true
  }

  if (message.type === 'GET_STATUS') {
    sendResponse({ email: USER_EMAIL, api: API_BASE })
    return true
  }
})

async function handleSearch(query) {
  try {
    if (!query || query.trim().length < 10) {
      return { results: [] }
    }

    const response = await fetch(`${API_BASE}/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: query.trim(),
        email: USER_EMAIL,
        limit: 3
      })
    })

    if (!response.ok) return { results: [] }

    const data = await response.json()
    return { results: data.results || [] }
  } catch (error) {
    console.error('Mind World search error:', error)
    return { results: [] }
  }
}

async function handleSummarize(conversationIds, currentQuery) {
  try {
    const response = await fetch(`${API_BASE}/summarize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversation_ids: conversationIds,
        current_query: currentQuery,
        email: USER_EMAIL
      })
    })

    if (!response.ok) return { error: 'Summarization failed' }

    const data = await response.json()
    return {
      contextBlock: data.context_block,
      summaries: data.summaries,
      count: data.conversation_count
    }
  } catch (error) {
    console.error('Mind World summarize error:', error)
    return { error: error.message }
  }
}

async function handleSaveConversation(conversation) {
  try {
    const response = await fetch(`${API_BASE}/save_conversation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: USER_EMAIL,
        conversation
      })
    })
    return { success: response.ok }
  } catch (error) {
    console.error('Mind World save error:', error)
    return { success: false }
  }
}
