importScripts('config.js', 'storage-utils.js')
const API_BASE = CONFIG.API_BASE

const UNIVERSAL_CONTENT_SCRIPT_ID = 'mw-universal-content-script'
const UNIVERSAL_ORIGINS = ['https://*/*', 'http://*/*']

// Ensure a stable device fingerprint exists (generated once per browser profile)
chrome.storage.local.get('mw_device_id', (stored) => {
  if (!stored.mw_device_id) {
    const deviceId = crypto.randomUUID()
    chrome.storage.local.set({ mw_device_id: deviceId })
  }
})

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

async function registerUniversalContentScripts() {
  if (!chrome.scripting || !chrome.scripting.registerContentScripts) return
  try {
    const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [UNIVERSAL_CONTENT_SCRIPT_ID] })
    if (existing && existing.length > 0) return
    await chrome.scripting.registerContentScripts([{
      id: UNIVERSAL_CONTENT_SCRIPT_ID,
      matches: UNIVERSAL_ORIGINS,
      excludeMatches: [
        'https://claude.ai/*',
        'https://chatgpt.com/*',
        'https://gemini.google.com/*',
        'https://perplexity.ai/*',
        'https://mind-world.app/*',
        'https://mind-world-app-mv4yv.ondigitalocean.app/*'
      ],
      js: ['storage-utils.js', 'content.js', 'input-dock.js'],
      runAt: 'document_idle'
    }])
  } catch (e) {
    console.warn('Failed to register universal content script:', e)
  }
}

async function unregisterUniversalContentScripts() {
  if (!chrome.scripting || !chrome.scripting.unregisterContentScripts) return
  try {
    await chrome.scripting.unregisterContentScripts({ ids: [UNIVERSAL_CONTENT_SCRIPT_ID] })
  } catch (e) {
    console.warn('Failed to unregister universal content script:', e)
  }
}

async function syncUniversalContentScripts() {
  const stored = await chrome.storage.local.get(['mw_universal_enabled'])
  const granted = await chrome.permissions.contains({ origins: UNIVERSAL_ORIGINS }).catch(() => false)
  const enabled = stored.mw_universal_enabled === true && granted
  if (enabled) await registerUniversalContentScripts()
  else await unregisterUniversalContentScripts()
}

syncUniversalContentScripts()

function formatApiErrorDetail(body) {
  const d = body && body.detail
  if (typeof d === 'string') return d
  if (Array.isArray(d)) return d.map((x) => x.msg || JSON.stringify(x)).join('; ')
  return 'Request failed'
}

function replyAsync(sendResponse, promise) {
  Promise.resolve(promise)
    .then((result) => sendResponse(result ?? { error: 'empty_response' }))
    .catch((err) => sendResponse({ error: (err && err.message) || 'Background handler failed' }))
}

async function isMemoryEnabled() {
  const prefs = await chrome.storage.local.get(['mw_memory_enabled'])
  return prefs.mw_memory_enabled !== false
}

// Get credentials from Chrome storage
async function getCredentials() {
  const stored = await chrome.storage.local.get([
    'mw_email',
    'mw_api_key',
    'mw_access_token'
  ])
  return {
    email: stored.mw_email || null,
    apiKey: stored.mw_api_key || null,
    accessToken: stored.mw_access_token || null
  }
}

async function establishSession(email, apiKey = null) {
  const stored = await chrome.storage.local.get(['mw_access_token'])
  const body = { email }
  if (apiKey) body.api_key = apiKey
  if (stored.mw_access_token) body.access_token = stored.mw_access_token

  const res = await fetch(`${API_BASE}/auth/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  if (!res.ok) return null
  const data = await res.json()
  await chrome.storage.local.set({ mw_access_token: data.access_token })
  return data.access_token
}

async function getAccessToken() {
  const { email, apiKey, accessToken } = await getCredentials()
  if (!email) return null
  if (accessToken) {
    const refreshed = await establishSession(email, apiKey || null)
    if (refreshed) return refreshed
  }
  if (apiKey) {
    return establishSession(email, apiKey)
  }
  return null
}

// Refresh session when the service worker wakes so Improve/weave work without opening the popup.
chrome.storage.local.get(['mw_email', 'mw_api_key'], (stored) => {
  if (stored.mw_email) {
    establishSession(stored.mw_email, stored.mw_api_key || null).catch(() => {})
  }
})

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  const url = changeInfo.url || ''
  if (!url.includes('/auth/callback')) return

  try {
    const parsed = new URL(url)
    const host = parsed.hostname.toLowerCase()
    const allowedHosts = new Set(['mind-world.app', 'www.mind-world.app', 'localhost', '127.0.0.1'])
    if (!allowedHosts.has(host)) return

    const error = parsed.searchParams.get('error')
    // Legacy token-in-URL redirects are no longer accepted.
    if (parsed.searchParams.get('access_token')) return

    const code = parsed.searchParams.get('code')
    if (error || !code) return

    fetch(`${API_BASE}/auth/google/exchange`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code })
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data || !data.access_token || !data.email) return
        const storageUpdate = {
          mw_email: data.email,
          mw_access_token: data.access_token,
          mw_needs_password: data.needs_password ? '1' : '0'
        }
        chrome.storage.local.set(storageUpdate, () => {
          chrome.tabs.remove(tabId).catch(() => {})
          chrome.runtime.sendMessage({ type: 'AUTH_COMPLETE' }).catch(() => {})
        })
      })
      .catch(() => {})
  } catch {
    // ignore malformed callback URLs
  }
})

async function getAuthContext() {
  const creds = await getCredentials()
  if (!creds.email) return { error: 'not_logged_in' }
  const accessToken = await getAccessToken()
  if (!accessToken) return { error: 'auth_required' }
  return { email: creds.email, accessToken, apiKey: creds.apiKey }
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
  if (message.type === 'LOCAL_STATE_CLEARED') {
    chrome.storage.local.set({ mw_save_queue: [] }).catch(() => {})
    sendResponse({ success: true })
    return true
  }

  if (message.type === 'REGISTER_UNIVERSAL_CONTENT_SCRIPTS') {
    replyAsync(sendResponse, registerUniversalContentScripts().then(() => ({ success: true })))
    return true
  }

  if (message.type === 'UNREGISTER_UNIVERSAL_CONTENT_SCRIPTS') {
    replyAsync(sendResponse, unregisterUniversalContentScripts().then(() => ({ success: true })))
    return true
  }

  if (message.type === 'SEARCH') {
    replyAsync(sendResponse, handleSearch(message.query))
    return true // Keep channel open for async
  }

  if (message.type === 'ENGINEER_PROMPT') {
    replyAsync(sendResponse, handleEngineerPrompt(
      message.message,
      message.template,
      message.conversationIds,
      !!message.skipMemory,
      message.platform
    ))
    return true
  }

  if (message.type === 'COMPARE_ANSWERS') {
    replyAsync(sendResponse, handleCompareAnswers(message.message))
    return true
  }

  if (message.type === 'GET_PERSONALIZATION_SUMMARY') {
    replyAsync(sendResponse, handlePersonalizationSummary())
    return true
  }

  if (message.type === 'CONFIRM_PERSONALIZATION_SUMMARY') {
    replyAsync(sendResponse, handleConfirmPersonalizationSummary(message.action, message.correctionIds))
    return true
  }

  if (message.type === 'GET_TEMPLATES') {
    replyAsync(sendResponse, handleGetTemplates(!!message.forceRefresh))
    return true
  }

  if (message.type === 'GET_TEMPLATE_CATEGORIES') {
    replyAsync(sendResponse, handleGetTemplateCategories())
    return true
  }

  if (message.type === 'SUGGEST_TEMPLATES') {
    replyAsync(sendResponse, handleSuggestTemplates(
      message.draft,
      message.limit,
      message.category,
      message.tier
    ))
    return true
  }

  if (message.type === 'TRACK_TEMPLATE_USE') {
    replyAsync(sendResponse, handleTrackTemplateUse(message.name))
    return true
  }

  if (message.type === 'GET_MEMORY_STATS') {
    replyAsync(sendResponse, handleMemoryStats())
    return true
  }

  if (message.type === 'OPEN_POPUP') {
    chrome.action.openPopup().catch(() => {})
    sendResponse({})
    return true
  }

  if (message.type === 'PROMPT_EDIT_FEEDBACK') {
    replyAsync(sendResponse, handlePromptFeedback(message))
    return true
  }
})

async function handleSearch(query) {
  try {
    if (!query || query.trim().length < 2) {
      return { results: [] }
    }

    const auth = await getAuthContext()
    if (auth.error) {
      return { results: [], error: auth.error }
    }
    if (!(await isMemoryEnabled())) {
      return { results: [] }
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
        email: auth.email,
        access_token: auth.accessToken,
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

async function handleEngineerPrompt(userMessage, templateStr, conversationIds, skipMemory, platform) {
  try {
    const startedAt = Date.now()
    const auth = await getAuthContext()
    if (auth.error) return { error: auth.error }

    const memoryEnabled = await isMemoryEnabled()
    const stored = await chrome.storage.local.get('mw_device_id')

    const body = {
      email: auth.email,
      access_token: auth.accessToken,
      message: userMessage,
      template: templateStr || 'none',
      api_key: auth.apiKey || null,
      skip_memory: !!skipMemory || !memoryEnabled,
      device_id: stored.mw_device_id || null,
      platform: platform || null
    }
    if (conversationIds && conversationIds.length > 0) {
      body.conversation_ids = conversationIds
    }

    const response = await fetch(`${API_BASE}/engineer_prompt`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-MW-Client': 'mwext-f8c3a91d-v3'
      },
      body: JSON.stringify(body)
    })

    if (!response.ok) {
      const err = await response.json().catch(() => ({}))
      // Pass quota_exceeded through as a structured error so the UI can show upgrade CTA
      return { error: formatApiErrorDetail(err) || 'Engineer prompt failed' }
    }

    const data = await response.json()
    return {
      engineeredPrompt: data.prompt || data.engineered_prompt,
      conversationsUsed: data.conversations_used || 0,
      sourcesUsed: data.sources_used || [],
      memory: data.memory || null,
      latencyMs: Date.now() - startedAt
    }
  } catch (error) {
    return { error: error.message }
  }
}

async function handleCompareAnswers(userMessage) {
  try {
    const auth = await getAuthContext()
    if (auth.error) return { error: auth.error }

    const stored = await chrome.storage.local.get('mw_device_id')
    const response = await fetch(`${API_BASE}/compare_answers`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-MW-Client': 'mwext-f8c3a91d-v3'
      },
      body: JSON.stringify({
        email: auth.email,
        access_token: auth.accessToken,
        message: userMessage,
        api_key: auth.apiKey || null,
        device_id: stored.mw_device_id || null
      })
    })

    if (!response.ok) {
      const err = await response.json().catch(() => ({}))
      return { error: formatApiErrorDetail(err) || 'Comparison failed' }
    }

    const data = await response.json()
    return {
      engineeredPrompt: data.engineered_prompt,
      rawAnswer: data.raw_answer,
      improvedAnswer: data.improved_answer,
      originalDraft: data.original_draft,
      answerModelDisplay: data.answer_model_display || data.answer_model || '',
      engineerModelDisplay: data.engineer_model_display || data.engineer_model || ''
    }
  } catch (error) {
    return { error: error.message }
  }
}

async function handlePersonalizationSummary() {
  try {
    const auth = await getAuthContext()
    if (auth.error) return { error: auth.error }
    if (!(await isMemoryEnabled())) {
      return {
        hasEnoughHistory: false,
        shouldShowConfirmation: false,
        inferredSummary: '',
        summaryConfidence: 0,
        conversationCount: 0,
        quickCorrections: [],
        confirmedSummary: ''
      }
    }

    const response = await fetch(`${API_BASE}/personalization_summary`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: auth.email, access_token: auth.accessToken })
    })
    if (!response.ok) {
      const err = await response.json().catch(() => ({}))
      return { error: err.detail || 'Failed to load personalization summary' }
    }
    const data = await response.json()
    return {
      hasEnoughHistory: !!data.has_enough_history,
      shouldShowConfirmation: !!data.should_show_confirmation,
      inferredSummary: data.inferred_summary || '',
      summaryConfidence: data.summary_confidence || 0,
      conversationCount: data.conversation_count || 0,
      quickCorrections: data.quick_corrections || [],
      confirmedSummary: data.confirmed_summary || ''
    }
  } catch (error) {
    return { error: error.message }
  }
}

async function handleConfirmPersonalizationSummary(action, correctionIds) {
  try {
    const auth = await getAuthContext()
    if (auth.error) return { error: auth.error }

    const response = await fetch(`${API_BASE}/confirm_personalization_summary`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: auth.email,
        access_token: auth.accessToken,
        action: action || 'skip',
        correction_ids: correctionIds || []
      })
    })
    if (!response.ok) {
      const err = await response.json().catch(() => ({}))
      return { error: err.detail || 'Failed to save personalization summary' }
    }
    const data = await response.json()
    return {
      success: !!data.success,
      confirmedSummary: data.confirmed_summary || ''
    }
  } catch (error) {
    return { error: error.message }
  }
}

async function handleGetTemplates(forceRefresh = false) {
  try {
    const cacheKey = 'mw_templates_v3'
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

async function handleGetTemplateCategories() {
  try {
    const cacheKey = 'mw_template_categories'
    const cached = await chrome.storage.local.get([cacheKey, 'mw_categories_at'])
    const cacheAge = Date.now() - (cached.mw_categories_at || 0)
    if (cached[cacheKey] && cacheAge < 600000) {
      return { categories: cached[cacheKey] }
    }

    const response = await fetch(`${API_BASE}/templates/categories`)
    if (!response.ok) {
      return { categories: [], error: 'fetch_failed' }
    }
    const data = await response.json()
    const categories = data.categories || []
    await chrome.storage.local.set({
      [cacheKey]: categories,
      mw_categories_at: Date.now()
    })
    return { categories }
  } catch (error) {
    return { categories: [], error: error.message }
  }
}

async function handleSuggestTemplates(draft, limit, category, tier) {
  try {
    const auth = await getAuthContext()
    if (auth.error) return { templates: [], error: auth.error }

    const body = {
      email: auth.email,
      access_token: auth.accessToken,
      draft: draft || '',
      limit: limit || 5,
      category: category || '',
      tier: tier || ''
    }
    if (auth.apiKey) body.api_key = auth.apiKey

    const response = await fetch(`${API_BASE}/templates/suggest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
    if (!response.ok) {
      return { templates: [], error: 'suggest_failed' }
    }
    const data = await response.json()
    return { templates: data.templates || [] }
  } catch (error) {
    return { templates: [], error: error.message }
  }
}

const TEMPLATE_USAGE_KEY = 'mw_template_usage'

async function incrementLocalTemplateUsage(name) {
  if (!name) return
  const stored = await chrome.storage.local.get(TEMPLATE_USAGE_KEY)
  const usage = stored[TEMPLATE_USAGE_KEY] || {}
  usage[name] = (usage[name] || 0) + 1
  await chrome.storage.local.set({ [TEMPLATE_USAGE_KEY]: usage })

  const cacheKey = 'mw_templates_v3'
  const cached = await chrome.storage.local.get([cacheKey])
  if (cached[cacheKey]) {
    const templates = cached[cacheKey].map(t =>
      t.name === name ? { ...t, use_count: (t.use_count || 0) + 1 } : t
    )
    await chrome.storage.local.set({ [cacheKey]: templates })
  }
}

async function handleTrackTemplateUse(name) {
  try {
    if (!name) return { error: 'missing_name' }
    await incrementLocalTemplateUsage(name)
    const response = await fetch(`${API_BASE}/templates/track_use`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    })
    if (!response.ok) return { error: 'track_failed' }
    return { success: true }
  } catch (error) {
    return { error: error.message }
  }
}

async function handleMemoryStats() {
  try {
    const auth = await getAuthContext()
    if (auth.error) return { conversationCount: 0, platformCount: 0, error: auth.error }

    const response = await fetch(`${API_BASE}/user_stats`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: auth.email, access_token: auth.accessToken })
    })
    if (!response.ok) return { conversationCount: 0, platformCount: 0 }
    const data = await response.json()
    return {
      conversationCount: data.conversation_count || 0,
      platformCount: data.platform_count || 0
    }
  } catch (error) {
    return { conversationCount: 0, platformCount: 0, error: error.message }
  }
}

async function handlePromptFeedback(message) {
  try {
    const auth = await getAuthContext()
    if (auth.error) return { error: auth.error }

    const response = await fetch(`${API_BASE}/prompt_feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: auth.email,
        access_token: auth.accessToken,
        rating: (typeof message.rating === 'number') ? message.rating : 1,
        event_type: message.eventType || 'rating',
        goal: message.goal || '',
        prompt_preview: message.promptPreview || '',
        template_used: message.templateUsed || '',
        conversations_used: message.conversationsUsed || 0,
        goal_hash: message.goalHash || '',
        engineered_prompt_hash: message.engineeredPromptHash || '',
        final_prompt_hash: message.finalPromptHash || '',
        engineered_prompt_preview: message.engineeredPromptPreview || '',
        final_prompt_preview: message.finalPromptPreview || '',
        diff_metrics: message.diffMetrics || {},
        accepted_unedited: !!message.acceptedUnedited,
        edited: !!message.edited,
        latency_ms: message.latencyMs || null
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

    const { email } = await getCredentials()
    const accessToken = await getAccessToken()

    if (!email || !accessToken) return

    let anySuccess = false
    for (const conversation of queue) {
      try {
        const res = await fetch(`${API_BASE}/save_conversation`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email,
            access_token: accessToken,
            conversation
          })
        })
        if (res.ok) anySuccess = true
      } catch (err) {
        // do nothing
      }
    }

    if (anySuccess) {
      const hostPatterns = [
        'https://claude.ai/*',
        'https://chatgpt.com/*',
        'https://gemini.google.com/*',
        'https://perplexity.ai/*'
      ]
      chrome.tabs.query({ url: hostPatterns }, (tabs) => {
        tabs.forEach((tab) => {
          if (tab.id) {
            chrome.tabs.sendMessage(tab.id, { type: 'SAVE_CONFIRMED' }).catch(() => {})
          }
        })
      })
    }
  } catch (err) {
    // do nothing
  }
}

chrome.commands.onCommand.addListener((command) => {
  if (command !== 'improve-prompt') return
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tabId = tabs[0]?.id
    if (tabId) {
      chrome.tabs.sendMessage(tabId, { type: 'TRIGGER_IMPROVE' }).catch(() => {})
    }
  })
})

// Process any items queued while the service worker was asleep
processSaveQueue()

