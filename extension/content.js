// Mind World Content Script v2
// Smarter injection with preview panel

let sidebar = null
let searchTimeout = null
let lastQuery = ''
let isVisible = false
let stagedConversations = [] // conversations staged for injection
let currentResults = []      // last auto-search results
let currentQuery = ''

// Auto-save state
const savedConversationIds = new Set()
let saveDebounceTimer = null
let autoSaveObserver = null

init()

function init() {
  setTimeout(() => {
    injectSidebar()
    watchInputField()
    startAutoSave()
  }, 2000)

  let lastUrl = location.href
  new MutationObserver(() => {
    const url = location.href
    if (url !== lastUrl) {
      lastUrl = url
      setTimeout(() => {
        watchInputField()
        startAutoSave()
      }, 2000)
    }
  }).observe(document, { subtree: true, childList: true })
}

function injectSidebar() {
  const existing = document.getElementById('mind-world-sidebar')
  if (existing) existing.remove()

  sidebar = document.createElement('div')
  sidebar.id = 'mind-world-sidebar'
  sidebar.innerHTML = `
    <div id="mw-header">
      <span id="mw-logo">🌍</span>
      <span id="mw-title">Mind World</span>
      <button id="mw-close">×</button>
    </div>
    <div id="mw-search-bar">
      <input
        type="text"
        id="mw-search-input"
        placeholder="Search your memory..."
      />
      <button id="mw-search-btn">→</button>
    </div>
    <div id="mw-status">Watching for relevant memories...</div>
    <div id="mw-results"></div>
    <div id="mw-auto-engineer" style="display:none">
      <button id="mw-auto-engineer-btn">⚡ Engineer Prompt</button>
    </div>
    <div id="mw-staging" style="display:none">
      <div id="mw-staging-header">
        <span id="mw-staging-count">0 selected</span>
        <button id="mw-staging-clear">Clear</button>
      </div>
      <button id="mw-preview-btn">⚡ Engineer Prompt</button>
      <button id="mw-quick-inject-btn">Just inject context →</button>
    </div>
    <div id="mw-preview-panel" style="display:none">
      <div id="mw-preview-header">
        <span id="mw-preview-title">Engineered Prompt</span>
        <button id="mw-preview-close">×</button>
      </div>
      <textarea id="mw-preview-content" spellcheck="false"></textarea>
      <div id="mw-preview-actions">
        <button id="mw-confirm-inject">⚡ Use This Prompt</button>
        <button id="mw-cancel-inject">Cancel</button>
      </div>
    </div>
  `

  document.body.appendChild(sidebar)

  document.getElementById('mw-close').addEventListener('click', () => {
    sidebar.classList.remove('mw-visible')
    isVisible = false
  })

  document.getElementById('mw-staging-clear').addEventListener('click', () => {
    stagedConversations = []
    updateStagingArea()
  })

  document.getElementById('mw-preview-btn').addEventListener('click', () => {
    openEngineerPanel(stagedConversations.map(s => s.id))
  })

  document.getElementById('mw-quick-inject-btn').addEventListener('click', () => {
    openPreviewPanel()
  })

  document.getElementById('mw-auto-engineer-btn').addEventListener('click', () => {
    openEngineerPanel(currentResults.map(r => r.id))
  })

  document.getElementById('mw-preview-close').addEventListener('click', () => {
    document.getElementById('mw-preview-panel').style.display = 'none'
  })

  document.getElementById('mw-cancel-inject').addEventListener('click', () => {
    document.getElementById('mw-preview-panel').style.display = 'none'
  })

  document.getElementById('mw-confirm-inject').addEventListener('click', () => {
    const panel = document.getElementById('mw-preview-panel')
    const content = document.getElementById('mw-preview-content')
    const isLegacy = panel.dataset.injectMode === 'legacy'
    injectIntoChat(content.value, isLegacy)
    panel.style.display = 'none'
    stagedConversations = []
    updateStagingArea()
    updateStatus('✓ Injected successfully')
  })

  // Manual search
  const searchInput = document.getElementById('mw-search-input')
  const searchBtn = document.getElementById('mw-search-btn')

  searchBtn.addEventListener('click', () => {
    const query = searchInput.value.trim()
    if (query.length >= 2) {
      currentQuery = query
      performSearch(query)
    }
  })

  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const query = searchInput.value.trim()
      if (query.length >= 2) {
        currentQuery = query
        performSearch(query)
      }
    }
  })
}

function watchInputField() {
  const hostname = window.location.hostname

  function attachListeners(inputField) {
    if (inputField._mwWatching) return
    inputField._mwWatching = true

    // Standard input event
    inputField.addEventListener('input', handleInput)

    // ChatGPT and some editors use keyup instead
    inputField.addEventListener('keyup', handleInput)

    // Also watch for paste events
    inputField.addEventListener('paste', (e) => {
      setTimeout(() => handleInput(e), 100)
    })

  }

  // Watch for DOM changes to catch dynamically added inputs
  const observer = new MutationObserver(() => {
    const inputField = findInputField()
    if (inputField) attachListeners(inputField)
  })

  observer.observe(document.body, {
    childList: true,
    subtree: true
  })

  // Try immediately and with delays
  const delays = [500, 1000, 2000, 3000]
  delays.forEach(delay => {
    setTimeout(() => {
      const inputField = findInputField()
      if (inputField) attachListeners(inputField)
    }, delay)
  })
}

function findInputField() {
  const hostname = window.location.hostname

  if (hostname.includes('chatgpt.com')) {
    // ChatGPT specific - try multiple approaches
    const byId = document.querySelector('#prompt-textarea')
    if (byId) return byId

    const byClass = document.querySelector(
      'div.ProseMirror[contenteditable="true"]'
    )
    if (byClass) return byClass

    const byRole = document.querySelector(
      'div[role="textbox"][contenteditable="true"]'
    )
    if (byRole) return byRole
  }

  if (hostname.includes('claude.ai')) {
    const prosemirror = document.querySelector('.ProseMirror')
    if (prosemirror) return prosemirror

    const contenteditable = document.querySelector(
      '[contenteditable="true"]'
    )
    if (contenteditable) return contenteditable
  }

  if (hostname.includes('gemini.google.com')) {
    const editor = document.querySelector('.ql-editor')
    if (editor) return editor

    const contenteditable = document.querySelector(
      '[contenteditable="true"]'
    )
    if (contenteditable) return contenteditable
  }

  if (hostname.includes('perplexity.ai')) {
    const textarea = document.querySelector('textarea')
    if (textarea) return textarea

    const contenteditable = document.querySelector(
      '[contenteditable="true"]'
    )
    if (contenteditable) return contenteditable
  }

  // Generic fallback
  return (
    document.querySelector('[contenteditable="true"]') ||
    document.querySelector('textarea') ||
    null
  )
}

function isElementVisible(el) {
  return !!(
    el.offsetWidth ||
    el.offsetHeight ||
    el.getClientRects().length
  )
}

function handleInput(e) {
  const target = e.target
  const text = target.innerText ||
               target.value ||
               target.textContent || ''

  currentQuery = text.trim()

  if (searchTimeout) clearTimeout(searchTimeout)

  if (currentQuery.length < 15) return

  searchTimeout = setTimeout(() => {
    if (currentQuery !== lastQuery) {
      lastQuery = currentQuery
      performSearch(currentQuery)
    }
  }, 1500)
}

async function performSearch(query) {
  // Check if logged in first
  const response_status = await chrome.runtime.sendMessage({
    type: 'GET_STATUS'
  })

  if (!response_status?.loggedIn) {
    updateStatus('⚠️ Please log in via the Mind World extension icon')
    showSidebar()
    updateResults([])
    return
  }

  updateStatus('🔍 Searching your memories...')
  showSidebar()

  const response = await chrome.runtime.sendMessage({
    type: 'SEARCH',
    query: query
  })

  const results = response?.results || []

  if (results.length === 0) {
    updateStatus('No relevant memories found')
    updateResults([])
    return
  }

  updateStatus(`✨ ${results.length} relevant conversation${results.length > 1 ? 's' : ''} found`)
  updateResults(results)
}

function showSidebar() {
  if (!sidebar) injectSidebar()
  sidebar.classList.add('mw-visible')
  isVisible = true
}

function updateStatus(text) {
  const el = document.getElementById('mw-status')
  if (el) el.textContent = text
}

function updateResults(results) {
  currentResults = results
  const autoEngineer = document.getElementById('mw-auto-engineer')
  if (autoEngineer) {
    autoEngineer.style.display = results.length > 0 && stagedConversations.length === 0 ? 'block' : 'none'
  }

  const container = document.getElementById('mw-results')
  if (!container) return

  if (results.length === 0) {
    container.innerHTML = ''
    return
  }

  container.innerHTML = results.map((r, i) => {
    const isStaged = stagedConversations.some(s => s.id === r.id)
    const cleanPreview = r.preview
      .replace(/\[human\]/g, '')
      .replace(/\[assistant\]/g, '')
      .trim()
      .slice(0, 120)

    return `
      <div class="mw-result ${isStaged ? 'mw-staged' : ''}"
           data-id="${r.id}">
        <div class="mw-result-header">
          <span class="mw-source-badge">
            ${r.source === 'claude' ? '🟣' : '🟢'} ${r.source}
          </span>
          <span class="mw-similarity">
            ${Math.round(r.similarity * 100)}% match
          </span>
        </div>
        <div class="mw-result-title">${escapeHtml(r.title)}</div>
        <div class="mw-result-preview">${escapeHtml(cleanPreview)}...</div>
        <div class="mw-result-meta">
          ${r.num_messages} msgs · ${r.created_at.slice(0, 10)}
        </div>
        <button class="mw-stage-btn ${isStaged ? 'mw-staged-btn' : ''}"
                data-id="${r.id}"
                data-title="${escapeHtml(r.title)}"
                data-source="${r.source}"
                data-created="${r.created_at}">
          ${isStaged ? '✓ Added to inject' : '+ Add to inject'}
        </button>
      </div>
    `
  }).join('')

  container.querySelectorAll('.mw-stage-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const convo = {
        id: btn.dataset.id,
        title: btn.dataset.title,
        source: btn.dataset.source,
        created_at: btn.dataset.created
      }
      toggleStaged(convo)
      performSearch(lastQuery) // Re-render to show staged state
    })
  })
}

function toggleStaged(convo) {
  const exists = stagedConversations.some(s => s.id === convo.id)
  if (exists) {
    stagedConversations = stagedConversations.filter(s => s.id !== convo.id)
  } else {
    if (stagedConversations.length >= 4) {
      updateStatus('Max 4 conversations at once')
      return
    }
    stagedConversations.push(convo)
  }
  updateStagingArea()
}

function updateStagingArea() {
  const staging = document.getElementById('mw-staging')
  const count = document.getElementById('mw-staging-count')
  const autoEngineer = document.getElementById('mw-auto-engineer')

  if (!staging || !count) return

  if (stagedConversations.length === 0) {
    staging.style.display = 'none'
    if (autoEngineer) {
      autoEngineer.style.display = currentResults.length > 0 ? 'block' : 'none'
    }
  } else {
    staging.style.display = 'block'
    count.textContent = `${stagedConversations.length} selected`
    if (autoEngineer) autoEngineer.style.display = 'none'
  }
}

async function openEngineerPanel(conversationIds) {
  const panel = document.getElementById('mw-preview-panel')
  const content = document.getElementById('mw-preview-content')
  const title = document.getElementById('mw-preview-title')

  if (!panel || !content) return

  panel.style.display = 'flex'
  panel.dataset.injectMode = 'engineer'
  content.value = 'Engineering your prompt...'
  if (title) title.textContent = 'Engineered Prompt'

  const response = await chrome.runtime.sendMessage({
    type: 'ENGINEER_PROMPT',
    message: currentQuery,
    conversationIds: conversationIds && conversationIds.length > 0 ? conversationIds : null
  })

  if (response.error) {
    if (response.error === 'not_logged_in') {
      content.value = 'Open the Mind World extension and sign in with your email.'
    } else if (response.error === 'no_api_key') {
      content.value = '⚠️ Add your Anthropic API key to use this feature.\n\nClick the Mind World icon in your toolbar → API Settings'
    } else {
      content.value = 'Failed to engineer prompt: ' + response.error
    }
    return
  }

  content.value = response.engineeredPrompt
}

async function openPreviewPanel() {
  const panel = document.getElementById('mw-preview-panel')
  const content = document.getElementById('mw-preview-content')
  const title = document.getElementById('mw-preview-title')

  if (!panel || !content) return

  panel.style.display = 'flex'
  panel.dataset.injectMode = 'legacy'
  content.value = 'Generating smart summary...'
  if (title) title.textContent = 'Context Preview'

  const ids = stagedConversations.map(s => s.id)

  const response = await chrome.runtime.sendMessage({
    type: 'SUMMARIZE',
    conversationIds: ids,
    currentQuery: currentQuery
  })

  if (response.error) {
    if (response.error === 'not_logged_in' || response.error === 'not_configured') {
      content.value = 'Open the Mind World extension and sign in with your email.'
    } else if (response.error === 'no_api_key' || response.error === 'missing_api_key') {
      content.value = '⚠️ Add your Anthropic API key to use this feature.\n\nClick the Mind World icon in your toolbar → API Settings'
    } else {
      content.value = 'Failed to generate summary. Try again.'
    }
    return
  }

  content.value = response.contextBlock
}

function injectIntoChat(text, isLegacy) {
  const inputField = findInputField()
  if (!inputField) return

  let fullText
  if (isLegacy) {
    const userText = inputField.innerText ||
                     inputField.value ||
                     inputField.textContent || ''
    fullText = text + userText
  } else {
    fullText = text
  }

  if (inputField.tagName === 'TEXTAREA') {
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype, 'value'
    ).set
    nativeInputValueSetter.call(inputField, fullText)
    inputField.dispatchEvent(new Event('input', { bubbles: true }))
  } else if (inputField.contentEditable === 'true') {
    inputField.innerText = fullText

    const range = document.createRange()
    const sel = window.getSelection()
    range.selectNodeContents(inputField)
    range.collapse(false)
    sel.removeAllRanges()
    sel.addRange(range)

    inputField.dispatchEvent(new Event('input', { bubbles: true }))
  }

  inputField.focus()
}

function startAutoSave() {
  // Disconnect previous observer if navigating to a new conversation
  if (autoSaveObserver) {
    autoSaveObserver.disconnect()
    autoSaveObserver = null
  }

  const hostname = window.location.hostname
  const path = window.location.pathname

  const isConversation = (
    (hostname.includes('claude.ai') && /\/chat\/[a-f0-9-]+/.test(path)) ||
    (hostname.includes('chatgpt.com') && /\/c\/[a-zA-Z0-9-]+/.test(path)) ||
    (hostname.includes('gemini.google.com') && /\/app\/[a-zA-Z0-9]+/.test(path))
  )

  if (!isConversation) return

  // Attempt an initial save after page settles
  setTimeout(tryAutoSave, 4000)

  autoSaveObserver = new MutationObserver((mutations) => {
    // Ignore mutations inside our own sidebar to avoid feedback loops
    const fromSidebar = mutations.some(m => sidebar && sidebar.contains(m.target))
    if (fromSidebar) return
    debounceAutoSave()
  })

  autoSaveObserver.observe(document.body, { childList: true, subtree: true })
}

function debounceAutoSave() {
  if (saveDebounceTimer) clearTimeout(saveDebounceTimer)
  // Wait 10 seconds after the last DOM mutation — by then streaming is done
  saveDebounceTimer = setTimeout(tryAutoSave, 10000)
}

function extractMessages() {
  const hostname = window.location.hostname
  const messages = []

  if (hostname.includes('claude.ai')) {
    // Strategy 1: data-testid attributes
    const els = document.querySelectorAll('[data-testid="human-turn"], [data-testid="ai-turn"]')
    if (els.length > 0) {
      els.forEach(el => {
        const role = el.dataset.testid === 'human-turn' ? 'human' : 'assistant'
        const text = el.innerText?.trim().slice(0, 2000) || ''
        if (text) messages.push({ role, content: text })
      })
      return messages
    }

    // Strategy 2: class names
    const humanEls = document.querySelectorAll('.human-turn')
    const aiEls = document.querySelectorAll('.ai-turn')
    if (humanEls.length > 0 || aiEls.length > 0) {
      humanEls.forEach(el => {
        const text = el.innerText?.trim().slice(0, 2000) || ''
        if (text) messages.push({ role: 'human', content: text })
      })
      aiEls.forEach(el => {
        const text = el.innerText?.trim().slice(0, 2000) || ''
        if (text) messages.push({ role: 'assistant', content: text })
      })
      return messages
    }

    // Strategy 3: partial class name matching
    const humanClassEls = document.querySelectorAll('[class*="human-turn"]')
    const assistantClassEls = document.querySelectorAll('[class*="ai-turn"], [class*="assistant-turn"]')
    if (humanClassEls.length > 0) {
      humanClassEls.forEach(el => {
        const text = el.innerText?.trim().slice(0, 2000) || ''
        if (text) messages.push({ role: 'human', content: text })
      })
      assistantClassEls.forEach(el => {
        const text = el.innerText?.trim().slice(0, 2000) || ''
        if (text) messages.push({ role: 'assistant', content: text })
      })
      return messages
    }
  }

  if (hostname.includes('chatgpt.com')) {
    // Strategy 1: data-message-author-role
    const els = document.querySelectorAll(
      '[data-message-author-role="user"], [data-message-author-role="assistant"]'
    )
    if (els.length > 0) {
      els.forEach(el => {
        const role = el.dataset.messageAuthorRole === 'user' ? 'human' : 'assistant'
        const text = el.innerText?.trim().slice(0, 2000) || ''
        if (text) messages.push({ role, content: text })
      })
      return messages
    }

    // Strategy 2: article elements (each article is one message turn)
    const articles = document.querySelectorAll('article[data-testid]')
    if (articles.length > 0) {
      articles.forEach((el, i) => {
        const role = i % 2 === 0 ? 'human' : 'assistant'
        const text = el.innerText?.trim().slice(0, 2000) || ''
        if (text) messages.push({ role, content: text })
      })
      return messages
    }

    // Strategy 3: generic articles
    const genericArticles = document.querySelectorAll('article')
    if (genericArticles.length > 0) {
      genericArticles.forEach((el, i) => {
        const role = i % 2 === 0 ? 'human' : 'assistant'
        const text = el.innerText?.trim().slice(0, 2000) || ''
        if (text) messages.push({ role, content: text })
      })
      return messages
    }
  }

  if (hostname.includes('gemini.google.com')) {
    // Strategy 1: data-chunk-index
    const chunkEls = document.querySelectorAll('[data-chunk-index]')
    if (chunkEls.length > 0) {
      chunkEls.forEach((el, i) => {
        const role = i % 2 === 0 ? 'human' : 'assistant'
        const text = el.innerText?.trim().slice(0, 2000) || ''
        if (text) messages.push({ role, content: text })
      })
      return messages
    }

    // Strategy 2: named query/response classes
    const userEls = document.querySelectorAll('.user-query-text, [class*="user-query"]')
    const modelEls = document.querySelectorAll('.model-response-text, [class*="model-response"]')
    if (userEls.length > 0 || modelEls.length > 0) {
      userEls.forEach(el => {
        const text = el.innerText?.trim().slice(0, 2000) || ''
        if (text) messages.push({ role: 'human', content: text })
      })
      modelEls.forEach(el => {
        const text = el.innerText?.trim().slice(0, 2000) || ''
        if (text) messages.push({ role: 'assistant', content: text })
      })
      return messages
    }

    // Strategy 3: partial class matching
    const userClassEls = document.querySelectorAll('[class*="user-query"]')
    const modelClassEls = document.querySelectorAll('[class*="model-response"], [class*="response-container"]')
    if (userClassEls.length > 0) {
      userClassEls.forEach(el => {
        const text = el.innerText?.trim().slice(0, 2000) || ''
        if (text) messages.push({ role: 'human', content: text })
      })
      modelClassEls.forEach(el => {
        const text = el.innerText?.trim().slice(0, 2000) || ''
        if (text) messages.push({ role: 'assistant', content: text })
      })
      return messages
    }
  }

  return messages
}

async function tryAutoSave() {
  try {
    const url = window.location.href
    const hostname = window.location.hostname
    const path = window.location.pathname
    console.log('Mind World: tryAutoSave triggered', hostname)

    let conversationId = null
    let source = null

    if (hostname.includes('claude.ai')) {
      const match = path.match(/\/chat\/([a-f0-9-]+)/)
      conversationId = match?.[1]
      source = 'claude'
    } else if (hostname.includes('chatgpt.com')) {
      const match = path.match(/\/c\/([a-zA-Z0-9-]+)/)
      conversationId = match?.[1]
      source = 'chatgpt'
    } else if (hostname.includes('gemini.google.com')) {
      const match = path.match(/\/app\/([a-zA-Z0-9]+)/)
      conversationId = match?.[1]
      source = 'gemini'
    }

    console.log('Mind World: conversationId', conversationId)

    if (!conversationId) {
      console.log('Mind World: no conversation ID found, skipping')
      return
    }
    if (savedConversationIds.has(conversationId)) {
      console.log('Mind World: already saved this session, skipping')
      return
    }

    const messages = extractMessages()
    console.log('Mind World: extracted messages count', messages.length)

    if (messages.length < 1) {
      console.log('Mind World: not enough messages, skipping')
      return
    }

    const titleEl = document.querySelector('title')
    const title = titleEl?.textContent
      ?.replace(/ - Claude| - ChatGPT| - Gemini/g, '')
      ?.trim() || 'Untitled'
    console.log('Mind World: title', title)

    const conversation = {
      id: conversationId,
      title,
      messages,
      url,
      platform: hostname,
      source,
      saved_at: new Date().toISOString()
    }

    // Write to storage queue instead of message passing
    // More reliable with MV3 service workers that go to sleep mid-async
    const queue = await chrome.storage.local.get('mw_save_queue')
    const existing = queue.mw_save_queue || []
    console.log('Mind World: current queue length', existing.length)

    if (!existing.find(c => c.id === conversation.id)) {
      existing.push(conversation)
      await chrome.storage.local.set({ mw_save_queue: existing })
      console.log('Mind World: added to queue, new length', existing.length)
      savedConversationIds.add(conversationId)
      showSaveToast()
    }
  } catch (err) {
    console.error('Mind World: tryAutoSave error', err)
  }
}

function showSaveToast() {
  const statusEl = document.getElementById('mw-status')
  if (!statusEl) return
  const prev = statusEl.textContent
  statusEl.textContent = '✓ Saved to memory'
  setTimeout(() => {
    if (statusEl.textContent === '✓ Saved to memory') {
      statusEl.textContent = prev
    }
  }, 2000)
}

function escapeHtml(text) {
  const div = document.createElement('div')
  div.appendChild(document.createTextNode(text || ''))
  return div.innerHTML
}
