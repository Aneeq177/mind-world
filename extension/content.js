// Mind World Content Script v2

// Smarter injection with preview panel



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



async function getAccumulatedMessages(conversationId) {

  const key = `mw_msgs_${conversationId}`

  const stored = await chrome.storage.local.get(key)

  return stored[key] || []

}



async function addMessageToAccumulator(conversationId, message) {

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

    injectSidebar()

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



  // Initialize DOM-Injected Prompt Builder

  injectPromptBuilderWidget()

  injectTriggerButton()

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

    <div id="mw-search-scope" style="display:none;gap:4px;margin-bottom:8px;">

      <button id="mw-scope-personal" style="flex:1;padding:4px 8px;border-radius:4px;border:1px solid rgba(124,58,237,0.5);background:rgba(124,58,237,0.3);color:white;font-size:0.75rem;cursor:pointer;">My Memory</button>

      <button id="mw-scope-company" style="flex:1;padding:4px 8px;border-radius:4px;border:1px solid rgba(255,255,255,0.1);background:transparent;color:#888;font-size:0.75rem;cursor:pointer;">🏢 Company</button>

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

      <div id="mw-preview-enrich-note" style="font-size:0.7rem;color:#888;text-align:center;margin-bottom:4px;"></div>

      <textarea id="mw-preview-content" spellcheck="false"></textarea>

      <div id="mw-preview-actions">

        <button id="mw-confirm-inject">⚡ Use This Prompt</button>

        <button id="mw-cancel-inject">Cancel</button>

      </div>

      <div id="mw-sidebar-feedback" style="display:flex;align-items:center;justify-content:center;gap:8px;padding:8px 0;">
        <span style="font-size:0.7rem;color:#666;">Helpful?</span>
        <button id="mw-sidebar-feedback-up" style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:6px;padding:4px 10px;cursor:pointer;font-size:14px;">👍</button>
        <button id="mw-sidebar-feedback-down" style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:6px;padding:4px 10px;cursor:pointer;font-size:14px;">👎</button>
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



  // Company scope hidden — prompt engineering is the focus
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



    // Standard input event

    inputField.addEventListener('input', handleInput)



    // ChatGPT and some editors use keyup instead

    inputField.addEventListener('keyup', handleInput)



    // Also watch for paste events

    inputField.addEventListener('paste', (e) => {

      setTimeout(() => handleInput(e), 100)

    })



    injectPromptBuilderButton(inputField)

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

  const response_status = await chrome.runtime.sendMessage({ type: 'GET_STATUS' })

  if (!response_status?.loggedIn) {

    updateStatus('⚠️ Please log in via the Mind World extension icon')

    showSidebar()

    updateResults([], false)

    return

  }



  if (currentScope === 'company') {

    updateStatus('🏢 Searching company memory...')

    showSidebar()

    const response = await chrome.runtime.sendMessage({ type: 'COMPANY_SEARCH', query })

    const results = response?.results || []

    if (results.length === 0) {

      updateStatus('No company conversations found')

      updateResults([], true)

      return

    }

    updateStatus(`🏢 ${results.length} company conversation${results.length > 1 ? 's' : ''} found`)

    updateResults(results, true)

  } else {

    updateStatus('🔍 Searching your memories...')

    showSidebar()

    const response = await chrome.runtime.sendMessage({ type: 'SEARCH', query })

    const results = response?.results || []

    if (results.length === 0) {

      updateStatus('No relevant memories found')

      updateResults([], false)

      return

    }

    updateStatus(`✨ ${results.length} relevant conversation${results.length > 1 ? 's' : ''} found`)

    updateResults(results, false)

  }

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

      const similarity = r.similarity ? Math.round(r.similarity * 100) : '—'

      return `

        <div class="mw-result" data-id="${r.id}">

          <div class="mw-result-header">

            <span class="mw-source-badge" style="background:rgba(99,102,241,0.2);color:#818cf8;border-radius:4px;padding:1px 5px;font-size:0.7rem;font-weight:700;">${initials}</span>

            <span class="mw-similarity">${similarity}% match</span>

          </div>

          <div class="mw-result-title">${escapeHtml(r.title)}</div>

          <div class="mw-result-preview">${escapeHtml(cleanPreview)}...</div>

          <div class="mw-result-meta">${r.owner_email || ''} · ${(r.created_at || '').slice(0, 10)}</div>

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
    updateStatus(rating === 1 ? 'Thanks for the feedback!' : 'Feedback recorded — we will improve')
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

    conversationIds: conversationIds && conversationIds.length > 0 ? conversationIds : null

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



  content.value = response.engineeredPrompt

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

}



function debounceAutoSave() {

  if (saveDebounceTimer) clearTimeout(saveDebounceTimer)

  // Wait 10 seconds after the last DOM mutation — by then streaming is done

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



  showSaveToast()

}



async function tryAutoSave() {

  try {

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

      showSaveToast()

    }

  } catch (err) {

    // do nothing

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

// --- DOM INJECTED PROMPT BUILDER ---

let builderWidgetHost = null
let builderShadow = null
let currentGoal = ''
let currentTemplate = 'none'
let currentQuestions = []
let lastEngineeredPrompt = ''
let lastConversationsUsed = 0
let cachedTemplates = []

function injectPromptBuilderWidget() {
  if (document.getElementById('mw-prompt-widget-host')) return

  builderWidgetHost = document.createElement('div')
  builderWidgetHost.id = 'mw-prompt-widget-host'

  builderShadow = builderWidgetHost.attachShadow({ mode: 'open' })

  const style = document.createElement('style')
  style.textContent = `
    #mw-widget {
      position: fixed;
      bottom: 80px;
      right: 20px;
      width: 380px;
      background: #111;
      border: 1px solid rgba(124,58,237,0.3);
      border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.4);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: white;
      z-index: 2147483647;
      display: none;
      flex-direction: column;
      overflow: hidden;
    }
    .mw-header {
      padding: 12px 16px;
      background: rgba(124,58,237,0.1);
      border-bottom: 1px solid rgba(124,58,237,0.2);
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-weight: 600;
      font-size: 14px;
    }
    .mw-header button {
      background: transparent;
      border: none;
      color: #888;
      cursor: pointer;
      font-size: 18px;
      line-height: 1;
    }
    .mw-header button:hover { color: white; }
    .mw-body {
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      max-height: 420px;
      overflow-y: auto;
    }
    textarea, .preview-area {
      width: 100%;
      background: rgba(255,255,255,0.05);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 6px;
      padding: 10px;
      color: white;
      font-size: 13px;
      resize: vertical;
      min-height: 60px;
      box-sizing: border-box;
      outline: none;
      font-family: inherit;
      line-height: 1.4;
    }
    .preview-area { min-height: 140px; max-height: 220px; }
    textarea:focus { border-color: rgba(124,58,237,0.5); }
    select {
      width: 100%;
      background: rgba(255,255,255,0.05);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 6px;
      padding: 8px;
      color: white;
      font-size: 13px;
      outline: none;
    }
    select option { background: #222; color: white; }
    button.primary {
      background: #7c3aed;
      color: white;
      border: none;
      padding: 10px;
      border-radius: 6px;
      cursor: pointer;
      font-weight: 600;
      transition: background 0.2s;
    }
    button.primary:hover { background: #6d28d9; }
    button.primary:disabled { background: #4c1d95; cursor: not-allowed; opacity: 0.7; }
    button.secondary {
      background: transparent;
      color: #aaa;
      border: 1px solid rgba(255,255,255,0.15);
      padding: 8px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 12px;
    }
    button.secondary:hover { color: white; border-color: rgba(255,255,255,0.3); }
    .chat-msg {
      padding: 10px;
      border-radius: 8px;
      font-size: 13px;
      line-height: 1.4;
      margin-bottom: 8px;
      white-space: pre-wrap;
    }
    .chat-user {
      background: rgba(124,58,237,0.2);
      border: 1px solid rgba(124,58,237,0.3);
      align-self: flex-end;
      margin-left: 20px;
    }
    .chat-ai {
      background: rgba(255,255,255,0.05);
      border: 1px solid rgba(255,255,255,0.1);
      align-self: flex-start;
      margin-right: 20px;
    }
    .chat-system {
      background: transparent;
      color: #888;
      font-style: italic;
      text-align: center;
      font-size: 12px;
      margin: 4px 0;
    }
    .enrich-note {
      font-size: 11px;
      color: #888;
      text-align: center;
    }
    .feedback-row {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      margin-top: 4px;
    }
    .feedback-row span { font-size: 11px; color: #666; }
    .feedback-btn {
      background: rgba(255,255,255,0.05);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 6px;
      padding: 6px 12px;
      cursor: pointer;
      font-size: 16px;
      line-height: 1;
    }
    .feedback-btn:hover { background: rgba(124,58,237,0.2); border-color: rgba(124,58,237,0.4); }
    .feedback-btn.selected { background: rgba(124,58,237,0.3); border-color: rgba(124,58,237,0.6); }
    label.field-label { font-size: 13px; color: #ccc; }
  `

  builderShadow.appendChild(style)

  const widget = document.createElement('div')
  widget.id = 'mw-widget'

  const header = document.createElement('div')
  header.className = 'mw-header'
  const headerTitle = document.createElement('span')
  headerTitle.textContent = '\u2728 Prompt Builder'
  const closeBtn = document.createElement('button')
  closeBtn.id = 'mw-close-widget'
  closeBtn.textContent = '\u00d7'
  header.appendChild(headerTitle)
  header.appendChild(closeBtn)

  const goalPhase = document.createElement('div')
  goalPhase.id = 'mw-phase-goal'
  goalPhase.className = 'mw-body'
  goalPhase.innerHTML = `
    <label class="field-label">What do you want to achieve?</label>
    <textarea id="mw-goal-input" placeholder="e.g. I want to debug a React performance issue..."></textarea>
    <label class="field-label">Template (Optional)</label>
    <select id="mw-template-select"><option value="none">Loading templates...</option></select>
    <button id="mw-start-btn" class="primary">Start Engineering</button>
  `

  const chatPhase = document.createElement('div')
  chatPhase.id = 'mw-phase-chat'
  chatPhase.className = 'mw-body'
  chatPhase.style.display = 'none'
  chatPhase.innerHTML = `
    <div id="mw-chat-history" style="flex:1;overflow-y:auto;display:flex;flex-direction:column;"></div>
    <textarea id="mw-chat-input" placeholder="Your answers..."></textarea>
    <button id="mw-send-btn" class="primary">Generate Prompt</button>
  `

  const previewPhase = document.createElement('div')
  previewPhase.id = 'mw-phase-preview'
  previewPhase.className = 'mw-body'
  previewPhase.style.display = 'none'
  previewPhase.innerHTML = `
    <div id="mw-preview-enrich" class="enrich-note"></div>
    <textarea id="mw-preview-text" class="preview-area" spellcheck="false"></textarea>
    <button id="mw-inject-btn" class="primary">\u26a1 Use This Prompt</button>
    <button id="mw-back-btn" class="secondary">Back to edit answers</button>
    <div class="feedback-row">
      <span>Was this prompt helpful?</span>
      <button id="mw-feedback-up" class="feedback-btn" title="Helpful">\u{1F44D}</button>
      <button id="mw-feedback-down" class="feedback-btn" title="Not helpful">\u{1F44E}</button>
    </div>
  `

  widget.appendChild(header)
  widget.appendChild(goalPhase)
  widget.appendChild(chatPhase)
  widget.appendChild(previewPhase)
  builderShadow.appendChild(widget)
  document.body.appendChild(builderWidgetHost)

  setupWidgetListeners()
  loadWidgetTemplates()
}

async function loadWidgetTemplates() {
  if (!builderShadow) return
  const select = builderShadow.getElementById('mw-template-select')
  if (!select) return

  try {
    const res = await chrome.runtime.sendMessage({ type: 'GET_TEMPLATES' })
    cachedTemplates = res.templates || []
  } catch (e) {
    cachedTemplates = []
  }

  select.innerHTML = ''
  const noneOpt = document.createElement('option')
  noneOpt.value = 'none'
  noneOpt.textContent = 'No Template (Custom)'
  select.appendChild(noneOpt)

  const byCategory = {}
  cachedTemplates.forEach(t => {
    const cat = t.category || 'General'
    if (!byCategory[cat]) byCategory[cat] = []
    byCategory[cat].push(t)
  })

  Object.keys(byCategory).sort().forEach(cat => {
    const group = document.createElement('optgroup')
    group.label = cat
    byCategory[cat].forEach(t => {
      const opt = document.createElement('option')
      opt.value = t.name
      opt.textContent = t.name
      group.appendChild(opt)
    })
    select.appendChild(group)
  })

  if (cachedTemplates.length === 0) {
    const fallbacks = [
      'Code Debugger', 'Academic Reviewer', 'Creative Copywriter',
      'Brainstorming Partner', 'Interview Prep'
    ]
    fallbacks.forEach(name => {
      const opt = document.createElement('option')
      opt.value = name
      opt.textContent = name
      select.appendChild(opt)
    })
  }
}

function suggestTemplateForGoal(goal) {
  if (!goal || cachedTemplates.length === 0) return 'none'
  const lower = goal.toLowerCase()
  const rules = [
    { keywords: ['debug', 'bug', 'error', 'code', 'function', 'python', 'javascript', 'react'], name: 'Code Debugger' },
    { keywords: ['essay', 'paper', 'thesis', 'academic', 'admission'], name: 'Academic Reviewer' },
    { keywords: ['resume', 'cv', 'job', 'career', 'interview'], name: 'Interview Prep' },
    { keywords: ['brainstorm', 'ideas', 'creative', 'marketing', 'copy'], name: 'Brainstorming Partner' },
    { keywords: ['write', 'copy', 'headline', 'ad'], name: 'Creative Copywriter' },
    { keywords: ['decide', 'decision', 'choose', 'pros and cons'], name: "Devil's Advocate" },
    { keywords: ['email', 'message', 'professional'], name: 'Email Writer' },
    { keywords: ['study', 'exam', 'learn', 'course'], name: 'Study Planner' },
    { keywords: ['architect', 'design', 'system', 'api'], name: 'System Architect' },
  ]
  for (const rule of rules) {
    if (rule.keywords.some(kw => lower.includes(kw))) {
      const match = cachedTemplates.find(t => t.name === rule.name)
      if (match) return match.name
    }
  }
  return 'none'
}

function resetWidgetState() {
  if (!builderShadow) return
  builderShadow.getElementById('mw-phase-goal').style.display = 'flex'
  builderShadow.getElementById('mw-phase-chat').style.display = 'none'
  builderShadow.getElementById('mw-phase-preview').style.display = 'none'
  builderShadow.getElementById('mw-goal-input').value = ''
  builderShadow.getElementById('mw-chat-input').value = ''
  builderShadow.getElementById('mw-chat-input').disabled = false
  builderShadow.getElementById('mw-send-btn').disabled = false
  builderShadow.getElementById('mw-chat-history').innerHTML = ''
  builderShadow.getElementById('mw-template-select').value = 'none'
  currentGoal = ''
  currentTemplate = 'none'
  currentQuestions = []
  lastEngineeredPrompt = ''
  lastConversationsUsed = 0
}

function setupWidgetListeners() {
  const widget = builderShadow.getElementById('mw-widget')
  const closeBtn = builderShadow.getElementById('mw-close-widget')
  const startBtn = builderShadow.getElementById('mw-start-btn')
  const sendBtn = builderShadow.getElementById('mw-send-btn')
  const goalPhase = builderShadow.getElementById('mw-phase-goal')
  const chatPhase = builderShadow.getElementById('mw-phase-chat')
  const previewPhase = builderShadow.getElementById('mw-phase-preview')
  const goalInput = builderShadow.getElementById('mw-goal-input')
  const templateSelect = builderShadow.getElementById('mw-template-select')
  const chatHistory = builderShadow.getElementById('mw-chat-history')
  const chatInput = builderShadow.getElementById('mw-chat-input')
  const previewText = builderShadow.getElementById('mw-preview-text')
  const injectBtn = builderShadow.getElementById('mw-inject-btn')
  const backBtn = builderShadow.getElementById('mw-back-btn')
  const enrichNote = builderShadow.getElementById('mw-preview-enrich')
  const feedbackUp = builderShadow.getElementById('mw-feedback-up')
  const feedbackDown = builderShadow.getElementById('mw-feedback-down')

  closeBtn.addEventListener('click', () => {
    widget.style.display = 'none'
    resetWidgetState()
  })

  goalInput.addEventListener('blur', () => {
    const suggested = suggestTemplateForGoal(goalInput.value.trim())
    if (suggested !== 'none') templateSelect.value = suggested
  })

  function addMsg(role, text) {
    const div = document.createElement('div')
    div.className = 'chat-msg chat-' + role
    div.textContent = text
    chatHistory.appendChild(div)
    chatHistory.scrollTop = chatHistory.scrollHeight
    return div
  }

  function showPreview(promptText, conversationsUsed) {
    lastEngineeredPrompt = promptText
    lastConversationsUsed = conversationsUsed || 0
    chatPhase.style.display = 'none'
    previewPhase.style.display = 'flex'
    previewText.value = promptText
    if (conversationsUsed > 0) {
      enrichNote.textContent = 'Enriched with ' + conversationsUsed + ' past conversation' + (conversationsUsed > 1 ? 's' : '')
    } else {
      enrichNote.textContent = 'Engineered from your goal and answers'
    }
    feedbackUp.classList.remove('selected')
    feedbackDown.classList.remove('selected')
  }

  async function submitFeedback(rating) {
    feedbackUp.classList.toggle('selected', rating === 1)
    feedbackDown.classList.toggle('selected', rating === -1)
    try {
      await chrome.runtime.sendMessage({
        type: 'PROMPT_FEEDBACK',
        rating,
        goal: currentGoal,
        promptPreview: lastEngineeredPrompt.slice(0, 500),
        templateUsed: currentTemplate,
        conversationsUsed: lastConversationsUsed
      })
    } catch (e) { /* ignore */ }
  }

  feedbackUp.addEventListener('click', () => submitFeedback(1))
  feedbackDown.addEventListener('click', () => submitFeedback(-1))

  startBtn.addEventListener('click', async () => {
    const goal = goalInput.value.trim()
    if (!goal) return

    currentGoal = goal
    currentTemplate = templateSelect.value

    goalPhase.style.display = 'none'
    chatPhase.style.display = 'flex'
    chatHistory.innerHTML = ''

    addMsg('user', goal)
    const loader = addMsg('system', 'Analyzing your goal...')

    try {
      const res = await chrome.runtime.sendMessage({
        type: 'GENERATE_QUESTIONS',
        goal: currentGoal,
        template: currentTemplate
      })

      loader.remove()

      if (res.error) {
        addMsg('system', 'Error: ' + res.error)
        return
      }

      currentQuestions = res.questions || []
      const qText = 'I have a few clarifying questions:\n' + currentQuestions.map((q, i) => (i + 1) + '. ' + q).join('\n')
      addMsg('ai', qText)
      chatInput.focus()
    } catch (e) {
      loader.remove()
      addMsg('system', 'Network error.')
    }
  })

  sendBtn.addEventListener('click', async () => {
    const answers = chatInput.value.trim()
    if (!answers) return

    addMsg('user', answers)
    chatInput.value = ''
    chatInput.disabled = true
    sendBtn.disabled = true

    const loader = addMsg('system', 'Engineering final prompt...')

    const combinedMessage = 'Goal: ' + currentGoal + '\n\nClarifying Questions:\n' +
      currentQuestions.map((q, i) => (i + 1) + '. ' + q).join('\n') +
      '\n\nMy Answers:\n' + answers

    try {
      const res = await chrome.runtime.sendMessage({
        type: 'ENGINEER_PROMPT',
        message: combinedMessage,
        template: currentTemplate
      })

      loader.remove()

      if (res.error) {
        addMsg('system', 'Error: ' + res.error)
        chatInput.disabled = false
        sendBtn.disabled = false
        return
      }

      showPreview(res.engineeredPrompt, res.conversationsUsed)
    } catch (e) {
      loader.remove()
      addMsg('system', 'Network error.')
      chatInput.disabled = false
      sendBtn.disabled = false
    }
  })

  injectBtn.addEventListener('click', () => {
    injectIntoChat(previewText.value, false)
    widget.style.display = 'none'
    resetWidgetState()
  })

  backBtn.addEventListener('click', () => {
    previewPhase.style.display = 'none'
    chatPhase.style.display = 'flex'
    chatInput.disabled = false
    sendBtn.disabled = false
    chatInput.focus()
  })
}

function togglePromptBuilder() {
  if (!builderShadow) injectPromptBuilderWidget()
  const widget = builderShadow.getElementById('mw-widget')

  if (widget.style.display === 'flex') {
    widget.style.display = 'none'
  } else {
    widget.style.display = 'flex'
    loadWidgetTemplates()
    const goalPhase = builderShadow.getElementById('mw-phase-goal')
    if (goalPhase.style.display !== 'none') {
      builderShadow.getElementById('mw-goal-input').focus()
    } else if (builderShadow.getElementById('mw-phase-preview').style.display !== 'none') {
      builderShadow.getElementById('mw-preview-text').focus()
    } else {
      builderShadow.getElementById('mw-chat-input').focus()
    }
  }
}

// Add a floating trigger button and hotkey
function injectTriggerButton() {
  if (document.getElementById('mw-floating-trigger')) return

  const btn = document.createElement('div')
  btn.id = 'mw-floating-trigger'
  btn.textContent = '\u2728'
  btn.title = 'Open Prompt Builder (Ctrl/Cmd + Shift + P)'
  Object.assign(btn.style, {
    position: 'fixed',
    bottom: '20px',
    right: '20px',
    width: '40px',
    height: '40px',
    background: '#7c3aed',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '20px',
    cursor: 'pointer',
    boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
    zIndex: '2147483646',
    transition: 'transform 0.2s',
    userSelect: 'none'
  })

  btn.onmouseover = () => { btn.style.transform = 'scale(1.1)' }
  btn.onmouseout = () => { btn.style.transform = 'scale(1)' }
  btn.onclick = togglePromptBuilder

  document.body.appendChild(btn)
}

document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'p') {
    e.preventDefault()
    togglePromptBuilder()
  }
})

