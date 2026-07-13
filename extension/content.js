// Mind World Content Script v2

// v1: input dock + Improve only. Legacy sidebar is disabled.
const MW_LEGACY_SIDEBAR = false

let sidebar = null

let searchTimeout = null

let lastQuery = ''

let isVisible = false

let stagedConversations = [] // conversations staged for injection

let currentResults = []      // last auto-search results

let currentQuery = ''

let currentScope = 'personal' // 'personal' | 'company'



// Auto-save state

const lastSavedAt = new Map()

const lastSavedMessageCount = new Map()

const minTimeBetweenSaves = 3000 // minimum 3s to avoid rapid duplicate saves

let saveDebounceTimer = null

let autoSaveObserver = null

async function isAutoSaveEnabled() {
  if (!(await isMindWorldLoggedIn())) return false
  const stored = await chrome.storage.local.get(['mw_autosave_enabled'])
  return stored.mw_autosave_enabled !== false
}



async function getAccumulatedMessages(conversationId) {

  const key = `mw_msgs_${conversationId}`

  const stored = await chrome.storage.local.get(key)

  return stored[key] || []

}



async function addMessageToAccumulator(conversationId, message) {
  if (!(await isMindWorldLoggedIn())) return []

  const key = `mw_msgs_${conversationId}`

  const existing = await getAccumulatedMessages(conversationId)



  const isDuplicate = existing.some(m =>

    m.role === message.role &&

    m.content.slice(0, 100) === message.content.slice(0, 100)

  )



  if (!isDuplicate) {

    existing.push(message)

    await chrome.storage.local.set({ [key]: existing })

  }



  return existing

}



async function clearAccumulatedMessages(conversationId) {

  const key = `mw_msgs_${conversationId}`

  await chrome.storage.local.remove(key)

}



init()



function watchForNewMessages() {

  const seenH2s = new Set()



  const observer = new MutationObserver(() => {

    const h2s = Array.from(document.querySelectorAll('h2'))



    h2s.forEach(async h2 => {

      const text = h2.innerText?.trim()

      if (!text) return

      const key = text + (h2.closest('div')?.className || '')

      if (seenH2s.has(key)) return



      const hostname = window.location.hostname

      if (!hostname.includes('claude.ai')) return



      const path = window.location.pathname

      const match = path.match(/\/chat\/([a-f0-9-]+)/)

      const conversationId = match?.[1]

      if (!conversationId) return



      if (text.includes('You said:')) {

        seenH2s.add(key)



        let el = h2.parentElement

        let msgText = ''

        for (let i = 0; i < 5; i++) {

          if (!el) break

          const bubble = el.querySelector(

            '[class*="bg-bg-300"], [class*="rounded-xl"][class*="pl-"]'

          )

          if (bubble) {

            msgText = bubble.innerText?.trim()

            break

          }

          el = el.parentElement

        }



        if (!msgText) {

          msgText = text.replace('You said:', '').trim()

        }



        if (msgText) {

          await addMessageToAccumulator(conversationId, {

            role: 'human',

            content: msgText.slice(0, 2000)

          })

        }

      }



      if (text.includes('Claude responded:')) {

        setTimeout(async () => {

          const currentText = h2.innerText?.trim()

          if (!currentText?.includes('Claude responded:')) return

          const currentKey = currentText + (h2.closest('div')?.className || '')

          if (seenH2s.has(currentKey)) return



          seenH2s.add(currentKey)



          let el = h2.parentElement

          let msgText = ''

          for (let i = 0; i < 5; i++) {

            if (!el) break

            const response = el.querySelector(

              '[class*="font-claude-response"]'

            )

            if (response) {

              msgText = response.innerText?.trim()

              break

            }

            el = el.parentElement

          }



          if (msgText) {

            const allMessages = await addMessageToAccumulator(

              conversationId,

              {

                role: 'assistant',

                content: msgText.slice(0, 2000)

              }

            )



            triggerAccumulatedSave(conversationId, allMessages)

          }

        }, 2000)

      }

    })

  })



  observer.observe(document.body, {

    childList: true,

    subtree: true

  })

}



function init() {

  setTimeout(() => {

    watchInputField()

    startAutoSave()

    watchForNewMessages()

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
  if (!MW_LEGACY_SIDEBAR) return

  const existing = document.getElementById('mind-world-sidebar')

  if (existing) existing.remove()



  sidebar = document.createElement('div')

  sidebar.id = 'mind-world-sidebar'

  sidebar.innerHTML = `

    <div id="mw-header">

      <span id="mw-logo">ðŸŒ</span>

      <span id="mw-title">Mind World</span>

      <button id="mw-close">Ã—</button>

    </div>

    <div id="mw-search-bar">

      <input

        type="text"

        id="mw-search-input"

        placeholder="Search your memory..."

      />

      <button id="mw-search-btn">â†’</button>

    </div>

    <div id="mw-search-scope" style="display:none;gap:4px;margin-bottom:8px;">

      <button id="mw-scope-personal" style="flex:1;padding:4px 8px;border-radius:4px;border:1px solid rgba(124,58,237,0.5);background:rgba(124,58,237,0.3);color:white;font-size:0.75rem;cursor:pointer;">My Memory</button>

      <button id="mw-scope-company" style="flex:1;padding:4px 8px;border-radius:4px;border:1px solid rgba(255,255,255,0.1);background:transparent;color:#888;font-size:0.75rem;cursor:pointer;">ðŸ¢ Company</button>

    </div>

    <div id="mw-status">Watching for relevant memories...</div>

    <div id="mw-results"></div>

    <div id="mw-auto-engineer" style="display:none">

      <button id="mw-auto-engineer-btn">âš¡ Engineer Prompt</button>

    </div>

    <div id="mw-staging" style="display:none">

      <div id="mw-staging-header">

        <span id="mw-staging-count">0 selected</span>

        <button id="mw-staging-clear">Clear</button>

      </div>

      <button id="mw-preview-btn">âš¡ Engineer Prompt</button>

      <button id="mw-quick-inject-btn">Just inject context â†’</button>

    </div>

    <div id="mw-preview-panel" style="display:none">

      <div id="mw-preview-header">

        <span id="mw-preview-title">Engineered Prompt</span>

        <button id="mw-preview-close">Ã—</button>

      </div>

      <div id="mw-preview-enrich-note" style="font-size:0.7rem;color:#888;text-align:center;margin-bottom:4px;"></div>

      <textarea id="mw-preview-content" spellcheck="false"></textarea>

      <div id="mw-preview-actions">

        <button id="mw-confirm-inject">âš¡ Use This Prompt</button>

        <button id="mw-cancel-inject">Cancel</button>

      </div>

      <div id="mw-sidebar-feedback" style="display:flex;align-items:center;justify-content:center;gap:8px;padding:8px 0;">
        <span style="font-size:0.7rem;color:#666;">Helpful?</span>
        <button id="mw-sidebar-feedback-up" style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:6px;padding:4px 10px;cursor:pointer;font-size:14px;">ðŸ‘</button>
        <button id="mw-sidebar-feedback-down" style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:6px;padding:4px 10px;cursor:pointer;font-size:14px;">ðŸ‘Ž</button>
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

    updateStatus('Injected successfully')

  })

  document.getElementById('mw-sidebar-feedback-up')?.addEventListener('click', () => {
    submitSidebarFeedback(1)
  })

  document.getElementById('mw-sidebar-feedback-down')?.addEventListener('click', () => {
    submitSidebarFeedback(-1)
  })



  // Company scope hidden â€” prompt engineering is the focus
  const scopeDiv = document.getElementById('mw-search-scope')
  if (scopeDiv) scopeDiv.style.display = 'none'
  currentScope = 'personal'



  document.getElementById('mw-scope-personal').addEventListener('click', () => {

    currentScope = 'personal'

    setActiveScope('personal')

    if (currentQuery) performSearch(currentQuery)

  })



  document.getElementById('mw-scope-company').addEventListener('click', () => {

    currentScope = 'company'

    setActiveScope('company')

    if (currentQuery) performSearch(currentQuery)

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



function setActiveScope(scope) {

  const personalBtn = document.getElementById('mw-scope-personal')

  const companyBtn = document.getElementById('mw-scope-company')

  if (!personalBtn || !companyBtn) return

  if (scope === 'company') {

    companyBtn.style.background = 'rgba(124,58,237,0.3)'

    companyBtn.style.border = '1px solid rgba(124,58,237,0.5)'

    companyBtn.style.color = 'white'

    personalBtn.style.background = 'transparent'

    personalBtn.style.border = '1px solid rgba(255,255,255,0.1)'

    personalBtn.style.color = '#888'

  } else {

    personalBtn.style.background = 'rgba(124,58,237,0.3)'

    personalBtn.style.border = '1px solid rgba(124,58,237,0.5)'

    personalBtn.style.color = 'white'

    companyBtn.style.background = 'transparent'

    companyBtn.style.border = '1px solid rgba(255,255,255,0.1)'

    companyBtn.style.color = '#888'

  }

}



function watchInputField() {

  const hostname = window.location.hostname



  function attachListeners(inputField) {

    if (inputField._mwWatching) return

    inputField._mwWatching = true



    if (typeof injectPromptBuilderButton === 'function') {

      injectPromptBuilderButton(inputField)

    }

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



  // Silent: keep currentQuery for Improve; no auto sidebar search

}



async function performSearch(query) {
  if (!MW_LEGACY_SIDEBAR) return

  const response_status = await chrome.runtime.sendMessage({ type: 'GET_STATUS' })

  if (!response_status?.loggedIn) {

    updateStatus('âš ï¸ Please log in via the Mind World extension icon')

    showSidebar()

    updateResults([], false)

    return

  }



  if (currentScope === 'company') {

    updateStatus('ðŸ¢ Searching company memory...')

    showSidebar()

    const response = await chrome.runtime.sendMessage({ type: 'COMPANY_SEARCH', query })

    const results = response?.results || []

    if (results.length === 0) {

      updateStatus('No company conversations found')

      updateResults([], true)

      return

    }

    updateStatus(`ðŸ¢ ${results.length} company conversation${results.length > 1 ? 's' : ''} found`)

    updateResults(results, true)

  } else {

    updateStatus('ðŸ” Searching your memories...')

    showSidebar()

    const response = await chrome.runtime.sendMessage({ type: 'SEARCH', query })

    const results = response?.results || []

    if (results.length === 0) {

      updateStatus('No relevant memories found')

      updateResults([], false)

      return

    }

    updateStatus(`âœ¨ ${results.length} relevant conversation${results.length > 1 ? 's' : ''} found`)

    updateResults(results, false)

  }

}



function showSidebar() {
  if (!MW_LEGACY_SIDEBAR) return

  if (!sidebar) injectSidebar()

  sidebar.classList.add('mw-visible')

  isVisible = true

}



function updateStatus(text) {

  const el = document.getElementById('mw-status')

  if (el) el.textContent = text

}



function updateResults(results, isCompany = false) {

  currentResults = results

  const autoEngineer = document.getElementById('mw-auto-engineer')

  if (autoEngineer) {

    autoEngineer.style.display = results.length > 0 && stagedConversations.length === 0 && !isCompany ? 'block' : 'none'

  }



  const container = document.getElementById('mw-results')

  if (!container) return



  if (results.length === 0) {

    container.innerHTML = ''

    return

  }



  if (isCompany) {

    container.innerHTML = results.map(r => {

      const cleanPreview = (r.preview || '')

        .replace(/\[human\]/g, '')

        .replace(/\[assistant\]/g, '')

        .trim()

        .slice(0, 120)

      const initials = r.owner_initials || '??'

      const similarity = r.similarity ? Math.round(r.similarity * 100) : 'â€”'

      return `

        <div class="mw-result" data-id="${escapeHtml(String(r.id || ''))}">

          <div class="mw-result-header">

            <span class="mw-source-badge" style="background:rgba(99,102,241,0.2);color:#818cf8;border-radius:4px;padding:1px 5px;font-size:0.7rem;font-weight:700;">${escapeHtml(initials)}</span>

            <span class="mw-similarity">${similarity}% match</span>

          </div>

          <div class="mw-result-title">${escapeHtml(r.title)}</div>

          <div class="mw-result-preview">${escapeHtml(cleanPreview)}...</div>

          <div class="mw-result-meta">${escapeHtml(r.owner_email || '')} · ${escapeHtml((r.created_at || '').slice(0, 10))}</div>

        </div>

      `

    }).join('')

    return

  }



  container.innerHTML = results.map(r => {

    const isStaged = stagedConversations.some(s => s.id === r.id)

    const cleanPreview = (r.preview || '')

      .replace(/\[human\]/g, '')

      .replace(/\[assistant\]/g, '')

      .trim()

      .slice(0, 120)



    return `

      <div class="mw-result ${isStaged ? 'mw-staged' : ''}"

           data-id="${escapeHtml(String(r.id || ''))}">

        <div class="mw-result-header">

          <span class="mw-source-badge">

            ${r.source === 'claude' ? 'ðŸŸ£' : 'ðŸŸ¢'} ${escapeHtml(r.source || '')}

          </span>

          <span class="mw-similarity">

            ${Math.round(r.similarity * 100)}% match

          </span>

        </div>

        <div class="mw-result-title">${escapeHtml(r.title)}</div>

        <div class="mw-result-preview">${escapeHtml(cleanPreview)}...</div>

        <div class="mw-result-meta">

          ${escapeHtml(String(r.num_messages || 0))} msgs Â· ${escapeHtml((r.created_at || '').slice(0, 10))}

        </div>

        <button class="mw-stage-btn ${isStaged ? 'mw-staged-btn' : ''}"

                data-id="${r.id}"

                data-title="${escapeHtml(r.title)}"

                data-source="${escapeHtml(r.source || '')}"

                data-created="${escapeHtml(r.created_at || '')}">

          ${isStaged ? 'âœ“ Added to inject' : '+ Add to inject'}

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

      performSearch(lastQuery)

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



async function submitSidebarFeedback(rating) {
  const panel = document.getElementById('mw-preview-panel')
  const content = document.getElementById('mw-preview-content')
  if (!panel || !content) return
  try {
    await chrome.runtime.sendMessage({
      type: 'PROMPT_FEEDBACK',
      rating,
      goal: currentQuery || '',
      promptPreview: content.value.slice(0, 500),
      templateUsed: 'none',
      conversationsUsed: parseInt(panel.dataset.conversationsUsed || '0', 10)
    })
    updateStatus(rating === 1 ? 'Thanks for the feedback!' : 'Feedback recorded â€” we will improve')
  } catch (e) { /* ignore */ }
}

async function openEngineerPanel(conversationIds) {

  const panel = document.getElementById('mw-preview-panel')

  const content = document.getElementById('mw-preview-content')

  const title = document.getElementById('mw-preview-title')

  const enrichNote = document.getElementById('mw-preview-enrich-note')



  if (!panel || !content) return



  panel.style.display = 'flex'

  panel.dataset.injectMode = 'engineer'

  content.value = 'Engineering your prompt...'

  if (title) title.textContent = 'Engineered Prompt'

  if (enrichNote) enrichNote.textContent = ''



  const response = await chrome.runtime.sendMessage({

    type: 'ENGINEER_PROMPT',

    message: currentQuery,

    conversationIds: conversationIds && conversationIds.length > 0 ? conversationIds : null,

    platform: location.hostname

  })



  if (response.error) {

    if (response.error === 'not_logged_in') {

      content.value = 'Open the Mind World extension and sign in with your email.'

    } else if (response.error === 'no_api_key') {

      content.value = 'Add your Anthropic API key to use this feature.\n\nClick the Mind World icon in your toolbar -> API Settings'

    } else {

      content.value = 'Failed to engineer prompt: ' + response.error

    }

    return

  }



  const raw = response.engineeredPrompt || ''

  content.value = typeof formatEngineeredPrompt === 'function'

    ? formatEngineeredPrompt(raw)

    : raw

  panel.dataset.conversationsUsed = String(response.conversationsUsed || 0)

  if (enrichNote) {
    const n = response.conversationsUsed || 0
    enrichNote.textContent = n > 0
      ? 'Enriched with ' + n + ' past conversation' + (n > 1 ? 's' : '')
      : 'Engineered from your query'
  }

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

      content.value = 'âš ï¸ Add your Anthropic API key to use this feature.\n\nClick the Mind World icon in your toolbar â†’ API Settings'

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

    const host = window.location.hostname

  if (host.includes('chatgpt.com') || host.includes('claude.ai') || host.includes('gemini.google.com')) {

      const blocks = fullText.split(/\n\n+/)

      inputField.innerHTML = blocks.map(block => {

        const lines = block.split('\n').map(l => l.trim()).filter(Boolean)

        if (!lines.length) return ''

        return '<p>' + lines.map(l => escapeHtml(l)).join('<br>') + '</p>'

      }).join('')

    } else {

      inputField.innerText = fullText

    }



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

  void (async () => {
    if (!(await isAutoSaveEnabled())) {
      if (autoSaveObserver) {
        autoSaveObserver.disconnect()
        autoSaveObserver = null
      }
      return
    }

    if (autoSaveObserver) {
      autoSaveObserver.disconnect()
      autoSaveObserver = null
    }

  const hostname = window.location.hostname

  const path = window.location.pathname



  const isConversation = (

    (hostname.includes('claude.ai') && /\/chat\/[a-f0-9-]+/.test(path)) ||

    (hostname.includes('chatgpt.com') && /\/c\/[a-zA-Z0-9-]+/.test(path)) ||

    (hostname.includes('gemini.google.com') && /\/app\/[a-zA-Z0-9]+/.test(path)) ||

    (hostname.includes('perplexity.ai') && path.length > 1)

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



  // Also save when AI finishes responding

  let streamingTimeout = null

  const streamObserver = new MutationObserver(() => {

    if (streamingTimeout) clearTimeout(streamingTimeout)

    streamingTimeout = setTimeout(() => {

      const hostname = window.location.hostname

      tryAutoSave()

    }, 3000)

  })



  streamObserver.observe(document.body, {

    childList: true,

    subtree: true,

    characterData: false

  })

  })()
}



function debounceAutoSave() {

  if (saveDebounceTimer) clearTimeout(saveDebounceTimer)

  // Wait 10 seconds after the last DOM mutation â€” by then streaming is done

  saveDebounceTimer = setTimeout(tryAutoSave, 10000)

}



function extractMessages(hostname) {

  const messages = []



  if (hostname.includes('claude.ai')) {

    const allDivs = Array.from(document.querySelectorAll('div'))

    let container = null



    for (const threshold of [1000, 500, 200]) {

      container = allDivs.find(el => {

        const style = window.getComputedStyle(el)

        return (style.overflowY === 'auto' ||

                style.overflowY === 'scroll') &&

               el.scrollHeight > threshold &&

               el.querySelectorAll('h2').length > 0

      })

      if (container) break

    }



    if (!container) {

      const h2s = Array.from(document.querySelectorAll('h2'))

      const messageH2 = h2s.find(h =>

        h.innerText?.includes('You said:') ||

        h.innerText?.includes('Claude responded:')

      )

      if (messageH2) {

        container = document.body

      }

    }



    if (!container) return messages

    

    // ... [Original parsing logic would be here, assuming it continues. Note: the file was truncated at line 1022 so we don't touch the rest of it directly, we will append at the very bottom]





    const h2s = Array.from(container.querySelectorAll('h2'))

    const messageH2s = h2s.filter(h =>

      h.innerText?.includes('You said:') ||

      h.innerText?.includes('Claude responded:')

    )



    messageH2s.forEach(h2 => {

      const text = h2.innerText?.trim()

      if (!text) return



      if (text.includes('You said:')) {

        let el = h2.parentElement

        for (let i = 0; i < 5; i++) {

          if (!el) break

          const bubble = el.querySelector(

            '[class*="bg-bg-300"], [class*="rounded-xl"][class*="pl-"]'

          )

          if (bubble) {

            const msgText = bubble.innerText?.trim()

            if (msgText && msgText.length > 0) {

              messages.push({

                role: 'human',

                content: msgText.slice(0, 2000)

              })

              return

            }

          }

          el = el.parentElement

        }

        const fallback = text.replace('You said:', '').trim()

        if (fallback.length > 0) {

          messages.push({ role: 'human', content: fallback.slice(0, 2000) })

        }

      }



      if (text.includes('Claude responded:')) {

        let el = h2.parentElement

        for (let i = 0; i < 5; i++) {

          if (!el) break

          const response = el.querySelector(

            '[class*="font-claude-response"]'

          )

          if (response) {

            const msgText = response.innerText?.trim()

            if (msgText && msgText.length > 0) {

              messages.push({

                role: 'assistant',

                content: msgText.slice(0, 2000)

              })

              return

            }

          }

          el = el.parentElement

        }

      }

    })



  }



  if (hostname.includes('chatgpt.com')) {

    const turns = document.querySelectorAll('[data-message-author-role]')

    turns.forEach(el => {

      const role = el.dataset.messageAuthorRole

      const text = el.innerText?.trim()

      if (text && (role === 'user' || role === 'assistant')) {

        messages.push({ role, content: text.slice(0, 2000) })

      }

    })

  }



  if (hostname.includes('gemini.google.com')) {

    const userTurns = document.querySelectorAll(

      '.user-query-text, [class*="user-query"]'

    )

    const modelTurns = document.querySelectorAll(

      '.model-response-text, [class*="model-response"]'

    )

    userTurns.forEach(el => {

      const text = el.innerText?.trim()

      if (text) messages.push({ role: 'human', content: text.slice(0, 2000) })

    })

    modelTurns.forEach(el => {

      const text = el.innerText?.trim()

      if (text) messages.push({ role: 'assistant', content: text.slice(0, 2000) })

    })

  }



  return messages

}



async function triggerAccumulatedSave(conversationId, messages) {
  if (!(await isMindWorldLoggedIn())) return
  if (!messages || messages.length === 0) return



  const lastCount = lastSavedMessageCount.get(conversationId) || 0

  if (messages.length <= lastCount) return



  const hostname = window.location.hostname

  const titleEl = document.querySelector('title')

  const title = titleEl?.textContent

    ?.replace(/ - Claude| - ChatGPT| - Gemini/g, '')

    ?.trim() || 'Untitled'



  const queue = await chrome.storage.local.get('mw_save_queue')

  const existing = queue.mw_save_queue || []



  const filtered = existing.filter(c => c.id !== conversationId)



  filtered.push({

    id: conversationId,

    title,

    messages,

    platform: hostname,

    saved_at: new Date().toISOString()

  })



  await chrome.storage.local.set({ mw_save_queue: filtered })

  lastSavedMessageCount.set(conversationId, messages.length)

  lastSavedAt.set(conversationId, Date.now())

}



async function tryAutoSave() {

  try {

    if (!(await isMindWorldLoggedIn())) return
    if (!(await isAutoSaveEnabled())) return

    const url = window.location.href

    const hostname = window.location.hostname

    const path = window.location.pathname



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



    if (!conversationId) return



    // Try accumulated messages first (more reliable than DOM scraping)

    const accumulated = await getAccumulatedMessages(conversationId)

    if (accumulated.length > 0) {

      await triggerAccumulatedSave(conversationId, accumulated)

      return

    }



    // Fall back to DOM extraction (handles page reload of existing conversation)

    const lastSaveTime = lastSavedAt.get(conversationId) || 0

    if (Date.now() - lastSaveTime < minTimeBetweenSaves) {

      return

    }



    const messages = extractMessages(hostname)



    if (messages.length < 1) {

      return

    }



    const lastCount = lastSavedMessageCount.get(conversationId) || 0

    if (messages.length <= lastCount) {

      return

    }



    const titleEl = document.querySelector('title')

    const title = titleEl?.textContent

      ?.replace(/ - Claude| - ChatGPT| - Gemini/g, '')

      ?.trim() || 'Untitled'



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



    if (!existing.find(c => c.id === conversation.id)) {

      existing.push(conversation)

      await chrome.storage.local.set({ mw_save_queue: existing })

      lastSavedAt.set(conversationId, Date.now())

      lastSavedMessageCount.set(conversationId, messages.length)

    }

  } catch (err) {

    // do nothing

  }

}



function showSaveToast() {

  let toast = document.getElementById('mw-save-toast')

  if (!toast) {

    toast = document.createElement('div')

    toast.id = 'mw-save-toast'

    toast.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:2147483646;padding:10px 16px;background:#111;border:1px solid rgba(110,231,183,0.4);border-radius:8px;color:#6ee7b7;font-size:13px;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;box-shadow:0 4px 20px rgba(0,0,0,0.4);opacity:0;transition:opacity 0.2s;pointer-events:none'

    document.body.appendChild(toast)

  }

  toast.textContent = 'Saved to memory'

  toast.style.opacity = '1'

  setTimeout(() => { toast.style.opacity = '0' }, 2500)



  const statusEl = document.getElementById('mw-status')

  if (!statusEl) return

  const prev = statusEl.textContent

  statusEl.textContent = 'âœ“ Saved to memory'

  setTimeout(() => {

    if (statusEl.textContent === 'âœ“ Saved to memory') {

      statusEl.textContent = prev

    }

  }, 2000)

}

function escapeHtml(text) {

  const div = document.createElement('div')

  div.appendChild(document.createTextNode(text || ''))

  return div.innerHTML

}

// Prompt Builder UI lives in input-dock.js (template chips + Improve popover)

function getCurrentConversationId() {
  const hostname = window.location.hostname
  const path = window.location.pathname

  if (hostname.includes('claude.ai')) {
    return path.match(/\/chat\/([a-f0-9-]+)/)?.[1] || null
  }
  if (hostname.includes('chatgpt.com')) {
    return path.match(/\/c\/([a-zA-Z0-9-]+)/)?.[1] || null
  }
  if (hostname.includes('gemini.google.com')) {
    return path.match(/\/app\/([a-zA-Z0-9]+)/)?.[1] || null
  }
  return null
}

async function handleLocalStateCleared() {
  lastSavedMessageCount.clear()
  lastSavedAt.clear()
  const conversationId = getCurrentConversationId()
  if (conversationId) await clearAccumulatedMessages(conversationId)
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'SAVE_CONFIRMED') showSaveToast()
  if (message.type === 'LOCAL_STATE_CLEARED') handleLocalStateCleared()
})
