// Mind World Content Script v2
// Smarter injection with preview panel

let sidebar = null
let searchTimeout = null
let lastQuery = ''
let isVisible = false
let stagedConversations = [] // conversations staged for injection
let currentQuery = ''

init()

function init() {
  setTimeout(() => {
    injectSidebar()
    watchInputField()
  }, 2000)

  let lastUrl = location.href
  new MutationObserver(() => {
    const url = location.href
    if (url !== lastUrl) {
      lastUrl = url
      setTimeout(() => {
        watchInputField()
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
    <div id="mw-status">Watching for relevant memories...</div>
    <div id="mw-results"></div>
    <div id="mw-staging" style="display:none">
      <div id="mw-staging-header">
        <span id="mw-staging-count">0 selected</span>
        <button id="mw-staging-clear">Clear</button>
      </div>
      <button id="mw-preview-btn">✨ Preview & Inject</button>
    </div>
    <div id="mw-preview-panel" style="display:none">
      <div id="mw-preview-header">
        <span>Context Preview</span>
        <button id="mw-preview-close">×</button>
      </div>
      <div id="mw-preview-content"></div>
      <div id="mw-preview-actions">
        <button id="mw-confirm-inject">⚡ Inject into Chat</button>
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
    openPreviewPanel()
  })

  document.getElementById('mw-preview-close').addEventListener('click', () => {
    document.getElementById('mw-preview-panel').style.display = 'none'
  })

  document.getElementById('mw-cancel-inject').addEventListener('click', () => {
    document.getElementById('mw-preview-panel').style.display = 'none'
  })

  document.getElementById('mw-confirm-inject').addEventListener('click', () => {
    const contextBlock = document.getElementById('mw-preview-content')
      .dataset.contextBlock
    injectIntoChat(contextBlock)
    document.getElementById('mw-preview-panel').style.display = 'none'
    stagedConversations = []
    updateStagingArea()
    updateStatus('✓ Context injected successfully')
  })
}

function watchInputField() {
  const observer = new MutationObserver(() => {
    const inputField = findInputField()
    if (inputField && !inputField._mwWatching) {
      inputField._mwWatching = true
      inputField.addEventListener('input', handleInput)
    }
  })

  observer.observe(document.body, { childList: true, subtree: true })

  const inputField = findInputField()
  if (inputField && !inputField._mwWatching) {
    inputField._mwWatching = true
    inputField.addEventListener('input', handleInput)
  }
}

function findInputField() {
  const selectors = [
    '.ProseMirror',
    '[contenteditable="true"]',
    'div[data-placeholder]',
    'textarea'
  ]
  for (const selector of selectors) {
    const el = document.querySelector(selector)
    if (el) return el
  }
  return null
}

function handleInput(e) {
  const text = e.target.innerText || e.target.value || ''
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

  if (!staging || !count) return

  if (stagedConversations.length === 0) {
    staging.style.display = 'none'
  } else {
    staging.style.display = 'block'
    count.textContent = `${stagedConversations.length} selected for injection`
  }
}

async function openPreviewPanel() {
  const panel = document.getElementById('mw-preview-panel')
  const content = document.getElementById('mw-preview-content')

  if (!panel || !content) return

  panel.style.display = 'flex'
  content.textContent = 'Generating smart summary...'

  const ids = stagedConversations.map(s => s.id)

  const response = await chrome.runtime.sendMessage({
    type: 'SUMMARIZE',
    conversationIds: ids,
    currentQuery: currentQuery
  })

  if (response.error) {
    content.textContent = 'Failed to generate summary. Try again.'
    return
  }

  content.textContent = response.contextBlock
  content.dataset.contextBlock = response.contextBlock
}

function injectIntoChat(contextBlock) {
  const inputField = findInputField()
  if (!inputField) return

  const userText = inputField.innerText || inputField.value || ''
  const fullText = contextBlock + userText

  if (inputField.contentEditable === 'true') {
    inputField.innerText = fullText

    // Move cursor to end
    const range = document.createRange()
    const sel = window.getSelection()
    range.selectNodeContents(inputField)
    range.collapse(false)
    sel.removeAllRanges()
    sel.addRange(range)
  } else {
    inputField.value = fullText
  }

  inputField.dispatchEvent(new Event('input', { bubbles: true }))
}

function escapeHtml(text) {
  const div = document.createElement('div')
  div.appendChild(document.createTextNode(text || ''))
  return div.innerHTML
}
