// Mind World Content Script v2

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



async function init() {

  const hostname = window.location.hostname

  // Never show the dock on our own web app / API — it can get matched once
  // Universal Mode grants broad host access.
  if (isMindWorldOwnHost(hostname)) return

  const knownPlatform = isMindWorldKnownPlatform(hostname)

  if (!knownPlatform) {
    // Unrecognized site: only run if the user explicitly turned on Universal Mode
    // (auto-save/message scraping still only runs on the four known platforms —
    // their selectors don't generalize to arbitrary chat UIs).
    const stored = await chrome.storage.local.get(['mw_universal_enabled'])
    if (!stored.mw_universal_enabled) return
  }

  setTimeout(() => {

    watchInputField()

    if (knownPlatform) {

      startAutoSave()

      watchForNewMessages()

    }

  }, 2000)



  let lastUrl = location.href

  new MutationObserver(() => {

    const url = location.href

    if (url !== lastUrl) {

      lastUrl = url

      setTimeout(() => {

        watchInputField()

        if (knownPlatform) startAutoSave()

      }, 2000)

    }

  }).observe(document, { subtree: true, childList: true })

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



function injectIntoChat(fullText) {

  const inputField = findInputField()

  if (!inputField) return



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



  autoSaveObserver = new MutationObserver(() => {

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
