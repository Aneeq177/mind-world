importScripts(
  'config.js',
  'storage-utils.js',
  'memory/schema.js',
  'memory/chunker.js',
  'memory/retrieval.js',
  'memory/scoring.js',
  'memory/engineer.js',
  'memory/local-db.js',
  'memory/engine-client.js',
  'memory/cloud-provider.js',
  'memory/local-provider.js',
  'memory/provider.js'
)
const API_BASE = CONFIG.API_BASE

mwResolveStorageModeOnStartup().catch((err) => console.warn('[mw] storage mode init failed:', err))

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

// A token the server accepted is reused for this long before checking again.
const MW_SESSION_CHECK_MS = 10 * 60 * 1000
let mwSessionCheck = null

async function establishSession(email, apiKey = null) {
  const stored = await chrome.storage.local.get(['mw_access_token'])
  const sent = stored.mw_access_token || null
  const body = { email }
  if (apiKey) body.api_key = apiKey
  if (sent) body.access_token = sent

  let res
  try {
    res = await fetch(`${API_BASE}/auth/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
  } catch (_) {
    // Server unreachable says nothing about the token; let the real request fail.
    return sent
  }
  if (!res.ok) {
    // The popup may have stored a new token (fresh sign-in) while this was in flight.
    const { mw_access_token: now } = await chrome.storage.local.get('mw_access_token')
    return now && now !== sent ? now : null
  }
  const data = await res.json()
  await chrome.storage.local.set({ mw_access_token: data.access_token, mw_session_checked_at: Date.now() })
  return data.access_token
}

/* The session token, checked with the server at most every MW_SESSION_CHECK_MS
 * and by one request at a time, however many callers ask at once. */
async function getAccessToken() {
  const { email, apiKey, accessToken } = await getCredentials()
  if (!email || (!accessToken && !apiKey)) return null
  if (accessToken) {
    const { mw_session_checked_at: checkedAt } = await chrome.storage.local.get('mw_session_checked_at')
    if (checkedAt && Date.now() - checkedAt < MW_SESSION_CHECK_MS) return accessToken
  }
  if (!mwSessionCheck) {
    mwSessionCheck = establishSession(email, apiKey || null).finally(() => { mwSessionCheck = null })
  }
  return mwSessionCheck
}

// Check the session when the service worker wakes so Improve works without opening the popup.
chrome.storage.local.get(['mw_email'], (stored) => {
  if (stored.mw_email) getAccessToken().catch(() => {})
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

  if (message.type === 'OPEN_IMPORT') {
    replyAsync(sendResponse, (async () => {
      if ((await mwGetStorageMode()) !== MW_STORAGE_MODES.LOCAL) return { opened: 'none' }
      await chrome.tabs.create({ url: chrome.runtime.getURL('import.html') })
      return { opened: 'page' }
    })())
    return true
  }

  if (message.type === 'PROMPT_EDIT_FEEDBACK') {
    replyAsync(sendResponse, handlePromptFeedback(message))
    return true
  }

  // Local-mode memory operations from extension pages (popup, import page).
  // The import page runs in a tab, so check the sender's URL rather than sender.tab;
  // content scripts report the host page's URL and are rejected here.
  const fromExtensionPage = sender.id === chrome.runtime.id &&
    (sender.url || '').startsWith(chrome.runtime.getURL(''))
  if (fromExtensionPage && MEMORY_PAGE_HANDLERS[message.type]) {
    replyAsync(sendResponse, MEMORY_PAGE_HANDLERS[message.type](message))
    return true
  }
})

async function requireLocalProvider() {
  if ((await mwGetStorageMode()) !== MW_STORAGE_MODES.LOCAL) {
    throw new Error('On-device memory is off. Switch to on-device memory in Mind World settings first.')
  }
  return mwGetProviderForMode(MW_STORAGE_MODES.LOCAL)
}

async function requireSameAccount(account) {
  if (!account) return
  const { mw_email: email } = await chrome.storage.local.get('mw_email')
  if (String(email || '').trim().toLowerCase() !== account) {
    throw new Error('A different account is signed in now. Choose the files again to import into this account')
  }
}

const MEMORY_PAGE_HANDLERS = {
  GET_ACCESS_TOKEN: async () => ({ accessToken: await getAccessToken() }),
  MW_LOCAL_IMPORT_BATCH: async (m) => {
    await requireSameAccount(m.account)
    return (await requireLocalProvider()).importConversations(m.conversations || [])
  },
  // Restoring a backup: the profile only replaces an empty on-device profile.
  MW_RESTORE_PROFILE: async (m) => (await requireLocalProvider()).importAll({ conversations: [], profile: m.profile }),
  MW_GET_PROFILE: async () => (await mwGetMemoryProvider()).getProfile(),
  MW_UPDATE_PROFILE: async (m) => (await mwGetMemoryProvider()).updateProfile({
    is_profile_enabled: m.is_profile_enabled,
    profile_data: m.profile_data
  }),
  MW_CLEAR_INFERRED_PROFILE: async () => (await mwGetMemoryProvider()).clearInferredProfile(),
  MW_EXPORT_LOCAL: async () => ({ data: await mwGetProviderForMode(MW_STORAGE_MODES.LOCAL).exportAll() }),
  MW_DELETE_LOCAL_MEMORY: async () => {
    await mwGetProviderForMode(MW_STORAGE_MODES.LOCAL).deleteAllMemory()
    await chrome.storage.local.remove('mw_import_job')
    return { success: true }
  },
  MW_ENGINE_STATUS: async () => MwEngine.status(),
  MW_ENGINE_WARM: async () => MwEngine.warm(),
  MW_SWITCH_STORAGE_MODE: (m) => switchStorageMode(m.mode, { clearCloud: !!m.clearCloud }),
  // Already on-device but the account still has cloud memory (e.g. signed in on a new browser).
  MW_COPY_CLOUD_TO_LOCAL: (m) => switchStorageMode(MW_STORAGE_MODES.LOCAL, { clearCloud: !!m.clearCloud, from: MW_STORAGE_MODES.CLOUD }),
  MW_GET_MIGRATION_STATUS: async () => ({ migration: (await chrome.storage.local.get(MIGRATION_KEY))[MIGRATION_KEY] || null })
}

/* ---- Switching storage modes ---------------------------------------------
 * cloud -> local: download the account export, index it on-device, then
 * optionally delete the cloud copy. local -> cloud: upload every on-device
 * conversation. The mode flips only after the copy succeeds, so a failure
 * leaves the user where they were. Progress is kept in storage for the popup.
 */

const MIGRATION_KEY = 'mw_migration'
let migrationRunning = null

async function setMigration(state) {
  await chrome.storage.local.set({ [MIGRATION_KEY]: { ...state, updated_at: Date.now() } })
}

function switchStorageMode(mode, { clearCloud = false, from = null } = {}) {
  if (migrationRunning) return migrationRunning
  migrationRunning = runStorageSwitch(mode, { clearCloud, from }).finally(() => { migrationRunning = null })
  return migrationRunning
}

async function runStorageSwitch(mode, { clearCloud, from: source }) {
  const target = mode === MW_STORAGE_MODES.CLOUD ? MW_STORAGE_MODES.CLOUD : MW_STORAGE_MODES.LOCAL
  const current = source || await mwGetStorageMode()
  if (current === target) {
    await mwSetStorageMode(target)
    return { success: true, mode: target, moved: 0 }
  }
  const from = mwGetProviderForMode(current)
  const to = mwGetProviderForMode(target)
  const progress = (phase) => ({ done, total }) => setMigration({ from: current, to: target, phase, done, total, status: 'running' })
  try {
    await setMigration({ from: current, to: target, phase: 'exporting', done: 0, total: 0, status: 'running' })
    const data = await from.exportAll()
    const total = (data.conversations || []).length
    await setMigration({ from: current, to: target, phase: 'copying', done: 0, total, status: 'running' })
    const result = await to.importAll(data, { onProgress: progress('copying') })
    if (total > 0 && (result.imported || 0) + (result.kept_newer || 0) === 0) {
      throw new Error('None of your chats could be copied. Check your connection and try again')
    }
    await mwSetStorageMode(target)
    if (target === MW_STORAGE_MODES.LOCAL) {
      const { mw_email: email } = await chrome.storage.local.get('mw_email')
      await chrome.storage.local.set({ mw_cloud_copy_offer_dismissed: email || true })
    }
    let cloudCleared = false
    let cloudKept = false
    if (target === MW_STORAGE_MODES.LOCAL && clearCloud) {
      const copied = (result.imported || 0) + (result.kept_newer || 0)
      if (total > 0 && copied >= total) {
        await setMigration({ from: current, to: target, phase: 'clearing_cloud', done: total, total, status: 'running' })
        await from.deleteAllMemory()
        cloudCleared = true
      } else {
        cloudKept = true
      }
    }
    const summary = { success: true, mode: target, moved: result.imported || 0, total, ...result, cloudCleared, cloudKept }
    await setMigration({ from: current, to: target, phase: 'done', done: total, total, status: 'done', result: summary })
    return summary
  } catch (err) {
    const error = String((err && err.message) || err)
    await setMigration({ from: current, to: target, phase: 'failed', status: 'failed', error })
    return { error }
  }
}

async function handleSearch(query) {
  try {
    if (!query || query.trim().length < 2) {
      return { results: [] }
    }

    if (!(await isMindWorldLoggedIn())) {
      return { results: [], error: 'not_logged_in' }
    }
    if (!(await isMemoryEnabled())) {
      return { results: [] }
    }

    // Expand short queries for better semantic search
    let searchQuery = query.trim()
    if (searchQuery.split(' ').length <= 2) {
      searchQuery = expandQuery(searchQuery)
    }

    return (await mwGetMemoryProvider()).search(searchQuery, 5)
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
    if (!(await isMindWorldLoggedIn())) return { error: 'not_logged_in' }
    const provider = await mwGetMemoryProvider()
    return await provider.engineerPrompt({
      message: userMessage,
      template: templateStr,
      conversationIds,
      skipMemory,
      platform
    })
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
    if (!(await isMindWorldLoggedIn())) return { error: 'not_logged_in' }
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
    return await (await mwGetMemoryProvider()).getPersonalizationSummary()
  } catch (error) {
    return { error: error.message }
  }
}

async function handleConfirmPersonalizationSummary(action, correctionIds) {
  try {
    if (!(await isMindWorldLoggedIn())) return { error: 'not_logged_in' }
    return await (await mwGetMemoryProvider()).confirmPersonalizationSummary(action, correctionIds)
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
    if (!(await isMindWorldLoggedIn())) return { conversationCount: 0, platformCount: 0, error: 'not_logged_in' }
    const mode = await mwGetStorageMode()
    const stats = await mwGetProviderForMode(mode).getStats()
    return { ...stats, storageMode: mode }
  } catch (error) {
    return { conversationCount: 0, platformCount: 0, error: error.message }
  }
}

async function handlePromptFeedback(message) {
  try {
    if (!(await isMindWorldLoggedIn())) return { error: 'not_logged_in' }
    return await (await mwGetMemoryProvider()).recordEditFeedback(message)
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

    if (!(await isMindWorldLoggedIn())) return
    const { mw_email: account } = await chrome.storage.local.get('mw_email')
    const mode = await mwGetStorageMode()
    const provider = mwGetProviderForMode(mode)

    let anySuccess = false
    const retry = []
    for (const conversation of queue) {
      // A retry queued under another account never lands in this one's memory.
      if (conversation._mw_account && conversation._mw_account !== account) continue
      try {
        const res = await provider.saveConversation(conversation)
        if (res.saved) anySuccess = true
        if (res.reason === 'auth_required') return
      } catch (err) {
        // On-device indexing failed (e.g. the engine was still loading): retry a few times.
        const attempts = (conversation._mw_attempts || 0) + 1
        if (mode === MW_STORAGE_MODES.LOCAL && attempts < 3) retry.push({ ...conversation, _mw_attempts: attempts, _mw_account: account })
        else console.warn('[mw] auto-save failed:', err)
      }
    }
    if (retry.length) {
      setTimeout(async () => {
        const { mw_save_queue: current = [] } = await chrome.storage.local.get('mw_save_queue')
        await chrome.storage.local.set({ mw_save_queue: [...current, ...retry] })
      }, 15000)
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

