importScripts('config.js')
const API_BASE = CONFIG.API_BASE

// Keep service worker alive during operations
let keepAliveInterval = null

function startKeepAlive() {
  keepAliveInterval = setInterval(() => {
    chrome.storage.local.get('mw_keepalive', () => {})
  }, 20000)
}

function stopKeepAlive() {
  if (keepAliveInterval) {
    clearInterval(keepAliveInterval)
    keepAliveInterval = null
  }
}

startKeepAlive()

// Get credentials from Chrome storage
async function getCredentials() {
  const stored = await chrome.storage.local.get([
    'mw_email',
    'mw_api_key',
    'mw_default_visibility'
  ])
  return {
    email: stored.mw_email || null,
    apiKey: stored.mw_api_key || null,
    defaultVisibility: stored.mw_default_visibility || 'private'
  }
}

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

  if (message.type === 'SUMMARIZE') {
    handleSummarize(
      message.conversationIds,
      message.currentQuery
    ).then(sendResponse)
    return true
  }

  if (message.type === 'ENGINEER_PROMPT') {
    handleEngineerPrompt(message.message, message.template, message.conversationIds).then(sendResponse)
    return true
  }

  if (message.type === 'GENERATE_QUESTIONS') {
    handleGenerateQuestions(message.goal, message.template).then(sendResponse)
    return true
  }

  if (message.type === 'GET_TEMPLATES') {
    handleGetTemplates(!!message.forceRefresh).then(sendResponse)
    return true
  }

  if (message.type === 'PROMPT_FEEDBACK') {
    handlePromptFeedback(message).then(sendResponse)
    return true
  }

  if (message.type === 'COMPANY_SEARCH') {
    handleCompanySearch(message.query, message.limit).then(sendResponse)
    return true
  }

  if (message.type === 'GET_STATUS') {
    getCredentials().then(creds => {
      sendResponse({
        email: creds.email,
        apiKey: creds.apiKey,
        api: API_BASE,
        loggedIn: !!creds.email
      })
    })
    return true
  }
})

async function handleSearch(query) {
  try {
    if (!query || query.trim().length < 2) {
      return { results: [] }
    }

    const { email } = await getCredentials()
    if (!email) {
      return { results: [], error: 'not_logged_in' }
    }

    // Expand short queries for better semantic search
    let searchQuery = query.trim()
    if (searchQuery.split(' ').length <= 2) {
      searchQuery = expandQuery(searchQuery)
    }

    const response = await fetch(`${API_BASE}/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: searchQuery,
        email: email,
        limit: 5
      })
    })

    if (!response.ok) return { results: [] }

    const data = await response.json()
    return { results: data.results || [] }
  } catch (error) {
    return { results: [] }
  }
}

// Expand short queries into fuller phrases for better embedding
function expandQuery(query) {
  const expansions = {
    'transfer': 'college transfer application university admission',
    'code': 'coding programming software development',
    'coding': 'coding programming software development',
    'essay': 'essay writing college application personal statement',
    'career': 'career job internship professional development',
    'ai': 'artificial intelligence machine learning AI tools',
    'research': 'research paper academic study analysis',
    'math': 'mathematics calculations equations problem solving',
    'physics': 'physics science research experiment',
    'resume': 'resume job application career professional',
    'python': 'python programming code development',
    'java': 'java programming code development',
    'money': 'finance money economics budget',
    'health': 'health medical wellness fitness',
  }

  const lower = query.toLowerCase()

  // Check if we have a direct expansion
  if (expansions[lower]) {
    return expansions[lower]
  }

  // Otherwise wrap in a generic phrase
  return `conversations about ${query}`
}

async function handleCompanySearch(query, limit = 5) {
  try {
    if (!query || query.trim().length < 2) return { results: [] }
    const { email } = await getCredentials()
    if (!email) return { results: [], error: 'not_logged_in' }
    const response = await fetch(`${API_BASE}/company_search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, query: query.trim(), limit })
    })
    if (!response.ok) return { results: [] }
    const data = await response.json()
    return { results: data.results || [], company_members: data.company_members }
  } catch (error) {
    return { results: [] }
  }
}

async function handleSummarize(conversationIds, currentQuery) {
  try {
    const { email, apiKey } = await getCredentials()
    if (!email) return { error: 'not_logged_in' }

    const response = await fetch(`${API_BASE}/summarize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversation_ids: conversationIds,
        current_query: currentQuery,
        email: email
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
    return { error: error.message }
  }
}

async function handleEngineerPrompt(userMessage, templateStr, conversationIds) {
  try {
    const { email, apiKey } = await getCredentials()
    if (!email) return { error: 'not_logged_in' }

    const body = {
      email,
      message: userMessage,
      template: templateStr || 'none',
      api_key: apiKey || null
    }
    if (conversationIds && conversationIds.length > 0) {
      body.conversation_ids = conversationIds
    }

    const response = await fetch(`${API_BASE}/engineer_prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })

    if (!response.ok) {
      const err = await response.json().catch(() => ({}))
      return { error: err.detail || 'Engineer prompt failed' }
    }

    const data = await response.json()
    return {
      engineeredPrompt: data.prompt || data.engineered_prompt,
      conversationsUsed: data.conversations_used || 0
    }
  } catch (error) {
    return { error: error.message }
  }
}

async function handleGenerateQuestions(goal, templateStr) {
  try {
    const { apiKey } = await getCredentials()

    const response = await fetch(`${API_BASE}/generate_clarifying_questions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        goal: goal,
        template: templateStr || 'none',
        api_key: apiKey || null
      })
    })

    if (!response.ok) {
      const err = await response.json().catch(() => ({}))
      return { error: err.detail || 'Failed to generate questions' }
    }

    const data = await response.json()
    return {
      questions: data.questions || []
    }
  } catch (error) {
    return { error: error.message }
  }
}

async function handleGetTemplates(forceRefresh = false) {
  try {
    const cacheKey = 'mw_templates_v2'
    if (!forceRefresh) {
      const cached = await chrome.storage.local.get([cacheKey, 'mw_templates_at'])
      const cacheAge = Date.now() - (cached.mw_templates_at || 0)
      if (cached[cacheKey] && cacheAge < 300000) {
        return { templates: cached[cacheKey] }
      }
    }

    const response = await fetch(`${API_BASE}/templates?ts=${Date.now()}`)
    if (!response.ok) {
      return { templates: [], error: 'fetch_failed', status: response.status }
    }

    const data = await response.json()
    const templates = data.templates || []
    await chrome.storage.local.set({
      [cacheKey]: templates,
      mw_templates_at: Date.now()
    })
    return { templates, proCount: templates.filter(t => (t.tier || '').toLowerCase() === 'pro').length }
  } catch (error) {
    return { templates: [], error: error.message }
  }
}

async function handlePromptFeedback(message) {
  try {
    const { email } = await getCredentials()
    if (!email) return { error: 'not_logged_in' }

    const response = await fetch(`${API_BASE}/prompt_feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        rating: message.rating,
        goal: message.goal || '',
        prompt_preview: message.promptPreview || '',
        template_used: message.templateUsed || '',
        conversations_used: message.conversationsUsed || 0
      })
    })

    if (!response.ok) return { error: 'Failed to log feedback' }
    return { success: true }
  } catch (error) {
    return { error: error.message }
  }
}

// Process save queue when storage changes
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.mw_save_queue) {
    const newQueue = changes.mw_save_queue.newValue || []
    if (newQueue.length > 0) {
      processSaveQueue()
    }
  }
})

async function processSaveQueue() {
  try {
    const stored = await chrome.storage.local.get('mw_save_queue')
    const queue = stored.mw_save_queue || []

    if (queue.length === 0) return

    // Clear queue immediately to prevent double processing
    await chrome.storage.local.set({ mw_save_queue: [] })

    const { email, defaultVisibility } = await getCredentials()

    if (!email) return

    for (const conversation of queue) {
      try {
        await fetch(`${API_BASE}/save_conversation`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, conversation, visibility: defaultVisibility || 'private' })
        })
      } catch (err) {
        // do nothing
      }
    }
  } catch (err) {
    // do nothing
  }
}

// Process any items queued while the service worker was asleep
processSaveQueue()

