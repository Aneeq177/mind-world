// Mind World — input-adjacent UI (template chips + Improve popover)
// Loaded after content.js; uses findInputField() and injectIntoChat() from content.js

(function () {
  const DOCK_ID = 'mw-input-dock'
  const POPOVER_ID = 'mw-improve-popover-host'
  const MAX_CHIPS = 3
  const FAVORITES_KEY = 'mw_template_favorites'

  let cachedTemplates = []
  let cachedCategories = []
  let libraryState = { q: '', category: '', tier: '', favoritesOnly: false }

  function formatEngineeredPrompt(text) {
    if (!text) return ''
    let s = text.trim()
    s = s.replace(/\n*---+\n*/g, '\n\n')
    s = s.replace(/^---+\s*|\s*---+$/g, '')
    s = s.replace(/\*\*([^*]+)\*\*/g, '$1')
    const headers = [
      'CONTEXT FROM YOUR HISTORY', 'CONTEXT ABOUT ME', 'WHO YOU ARE',
      'WHAT YOU HAVE ALREADY EXPLORED', "WHAT I'VE ALREADY TRIED OR EXPLORED",
      'WHAT HAS BEEN DECIDED OR RULED OUT', 'WHAT HAS BEEN DECIDED',
      'CONSTRAINTS OR DECISIONS', 'MY REQUEST', 'YOUR QUESTION', 'YOUR TASK',
      'WHAT I NEED FROM YOU', 'ROLE', 'CONSTRAINTS', 'OUTPUT FORMAT'
    ]
    headers.forEach(h => {
      const re = new RegExp('\\s*(' + h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[^\\n]*:)', 'gi')
      s = s.replace(re, '\n\n$1\n')
    })
    s = s.replace(/\s+•\s+/g, '\n• ')
    s = s.replace(/(?<=\S)\s+(\d+\.\s+)/g, '\n\n$1')
    s = s.replace(/[ \t]+/g, ' ')
    s = s.replace(/\n{3,}/g, '\n\n')
    return s.trim()
  }

  window.formatEngineeredPrompt = formatEngineeredPrompt
  let dockHost = null
  let popoverShadow = null
  let anchoredInput = null
  let popoverState = { mode: 'closed', template: 'none', goal: '' }

  const FALLBACK_TEMPLATES = [
    { name: 'Code Debugger', template: 'You are an expert senior software engineer. Review the provided code, identify bugs, suggest optimizations, and explain your reasoning clearly.\n\n[Describe your code or paste it here:]' },
    { name: 'Academic Reviewer', template: 'Act as an expert academic reviewer. Analyze the draft for logic, flow, and evidence. Provide structured feedback.\n\n[Paste your draft here:]' },
    { name: 'Email Writer', template: 'You are an expert professional communicator. Draft a clear, concise email appropriate for the situation and audience.\n\n[Describe the situation:]' },
    { name: 'Interview Prep', template: 'You are a rigorous interviewer. Ask me one deep question at a time related to my field. Wait for my response before grading it.\n\n[My field / role:]' },
    { name: 'Brainstorming Partner', template: 'Act as a brilliant brainstorming partner. Generate 10 creative ideas related to the topic.\n\n[Topic:]' },
    { name: 'Decision Framework', template: 'You are a strategic decision advisor. Help me evaluate this decision using options, criteria, tradeoffs, and risks.\n\n[Decision:]' }
  ]

  function isProTemplate(t) {
    if (!t) return false
    if ((t.tier || '').toLowerCase() === 'pro') return true
    if (t.attribution && String(t.attribution).length > 15) return true
    if ((t.template || '').length > 500) return true
    if (/\(.*?Pro\)/i.test(t.name || '')) return true
    return false
  }

  async function loadTemplates(forceRefresh = false) {
    try {
      const res = await chrome.runtime.sendMessage({
        type: 'GET_TEMPLATES',
        forceRefresh
      })
      cachedTemplates = (res.templates && res.templates.length) ? res.templates : FALLBACK_TEMPLATES
      return res
    } catch (e) {
      cachedTemplates = FALLBACK_TEMPLATES
      return { templates: cachedTemplates, error: e.message }
    }
  }

  function getInputText(inputField) {
    const el = inputField || (typeof findInputField === 'function' ? findInputField() : null)
    if (!el) return ''
    return (el.value || el.innerText || el.textContent || '').trim()
  }

  function needsClarification(text) {
    const t = (text || '').trim()
    return t.length < 50 || t.split(/\s+/).filter(Boolean).length < 8
  }

  function suggestTemplateName(text) {
    const lower = (text || '').toLowerCase()
    const rules = [
      { kw: ['debug', 'bug', 'error', 'code', 'function'], name: 'Code Debugger' },
      { kw: ['essay', 'paper', 'thesis', 'academic'], name: 'Academic Reviewer' },
      { kw: ['email', 'message'], name: 'Email Writer' },
      { kw: ['cover letter', 'coverletter'], name: 'Cover Letter (CO-STAR Pro)' },
      { kw: ['interview', 'resume', 'job'], name: 'Interview Prep' },
      { kw: ['review code', 'pull request', 'pr review'], name: 'Code Review (Staff Engineer)' },
      { kw: ['decide', 'decision', 'choose'], name: 'Decision Framework' },
      { kw: ['brainstorm', 'ideas'], name: 'Brainstorming Partner' }
    ]
    for (const r of rules) {
      if (r.kw.some(k => lower.includes(k))) {
        const m = cachedTemplates.find(t => t.name === r.name)
        if (m) return m.name
      }
    }
    return 'none'
  }

  function getTemplateBody(name) {
    const t = cachedTemplates.find(x => x.name === name)
    return t ? (t.template || '') : ''
  }

  function ensurePopover() {
    if (document.getElementById(POPOVER_ID)) return
    const host = document.createElement('div')
    host.id = POPOVER_ID
    host.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;'
    popoverShadow = host.attachShadow({ mode: 'open' })
    const style = document.createElement('style')
    style.textContent = `
      .mw-pop {
        pointer-events: auto;
        width: 440px;
        max-width: calc(100vw - 24px);
        background: #111;
        border: 1px solid rgba(124,58,237,0.35);
        border-radius: 10px;
        box-shadow: 0 8px 32px rgba(0,0,0,0.45);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        color: #fff;
        padding: 12px;
        display: none;
        flex-direction: column;
        gap: 10px;
      }
      .mw-pop.open { display: flex; }
      .mw-pop h4 { margin: 0; font-size: 13px; font-weight: 600; color: #c4b5fd; }
      .mw-pop .note { font-size: 11px; color: #888; text-align: center; }
      .mw-pop textarea {
        width: 100%; min-height: 180px; max-height: 320px;
        white-space: pre-wrap;
        background: rgba(255,255,255,0.05);
        border: 1px solid rgba(255,255,255,0.12);
        border-radius: 6px; padding: 8px; color: #fff;
        font-size: 12px; resize: vertical; box-sizing: border-box;
        font-family: inherit; line-height: 1.4;
      }
      .mw-pop label { font-size: 12px; color: #aaa; }
      .mw-pop input {
        width: 100%; box-sizing: border-box;
        background: rgba(255,255,255,0.05);
        border: 1px solid rgba(255,255,255,0.12);
        border-radius: 6px; padding: 8px; color: #fff; font-size: 12px;
      }
      .mw-pop .q-block { margin-bottom: 8px; }
      .mw-pop .actions { display: flex; gap: 8px; flex-wrap: wrap; }
      .mw-pop button {
        flex: 1; min-width: 90px;
        padding: 8px 10px; border-radius: 6px; border: none;
        font-size: 12px; font-weight: 600; cursor: pointer;
      }
      .mw-pop .btn-primary { background: #7c3aed; color: #fff; }
      .mw-pop .btn-primary:hover { background: #6d28d9; }
      .mw-pop .btn-primary:disabled { opacity: 0.6; cursor: wait; }
      .mw-pop .btn-ghost {
        background: transparent; color: #aaa;
        border: 1px solid rgba(255,255,255,0.15);
      }
      .mw-pop .btn-ghost:hover { color: #fff; }
      .mw-pop .err { color: #f87171; font-size: 12px; }
      .mw-pop.library { width: 520px; max-height: 70vh; }
      .mw-pop .lib-search {
        width: 100%; box-sizing: border-box;
        background: rgba(255,255,255,0.05);
        border: 1px solid rgba(255,255,255,0.12);
        border-radius: 6px; padding: 8px 10px; color: #fff; font-size: 12px;
      }
      .mw-pop .lib-filters {
        display: flex; flex-wrap: wrap; gap: 4px; max-height: 72px; overflow-y: auto;
      }
      .mw-pop .lib-pill {
        padding: 3px 8px; font-size: 10px; border-radius: 12px; cursor: pointer;
        border: 1px solid rgba(124,58,237,0.35); background: transparent; color: #aaa;
      }
      .mw-pop .lib-pill.active {
        background: rgba(124,58,237,0.35); color: #e9d5ff; border-color: #7c3aed;
      }
      .mw-pop .lib-pill.pro-pill { border-color: rgba(251,191,36,0.4); color: #fcd34d; }
      .mw-pop .lib-pill.pro-pill.active { background: rgba(251,191,36,0.2); }
      .mw-pop .lib-list {
        max-height: 280px; overflow-y: auto; display: flex; flex-direction: column; gap: 4px;
      }
      .mw-pop .lib-item {
        text-align: left; padding: 8px 10px; border-radius: 6px; cursor: pointer;
        border: 1px solid rgba(255,255,255,0.08); background: rgba(255,255,255,0.03);
        color: #fff; font-size: 12px; display: flex; align-items: flex-start; gap: 8px;
      }
      .mw-pop .lib-item:hover { border-color: rgba(124,58,237,0.4); background: rgba(124,58,237,0.1); }
      .mw-pop .lib-item.pro { border-color: rgba(251,191,36,0.25); }
      .mw-pop .lib-item-body { flex: 1; min-width: 0; }
      .mw-pop .lib-item-name { font-weight: 600; color: #e9d5ff; }
      .mw-pop .lib-item-desc { font-size: 10px; color: #888; margin-top: 2px;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .mw-pop .lib-item-meta { font-size: 9px; color: #666; margin-top: 2px; }
      .mw-pop .lib-star {
        background: none; border: none; cursor: pointer; font-size: 14px;
        padding: 0; line-height: 1; color: #555; flex-shrink: 0;
      }
      .mw-pop .lib-star.on { color: #fbbf24; }
      .mw-pop .lib-empty { font-size: 11px; color: #888; text-align: center; padding: 16px; }
      .mw-pop .mw-sources { margin-top: 4px; }
      .mw-pop .mw-sources-toggle {
        background: none; border: none; color: #a78bfa; font-size: 11px;
        cursor: pointer; padding: 0; text-decoration: underline;
      }
      .mw-pop .mw-sources-list {
        margin-top: 8px; max-height: 120px; overflow-y: auto;
        display: flex; flex-direction: column; gap: 6px;
      }
      .mw-pop .mw-source-item {
        padding: 6px 8px; border-radius: 6px;
        background: rgba(124,58,237,0.08); border: 1px solid rgba(124,58,237,0.2);
        font-size: 11px;
      }
      .mw-pop .mw-source-item strong { color: #e9d5ff; display: block; }
      .mw-pop .mw-source-meta { color: #666; font-size: 10px; }
      .mw-pop .mw-source-item p { margin: 4px 0 0; color: #888; font-size: 10px; line-height: 1.3; }
      .mw-pop .mw-import-hint { font-size: 11px; color: #888; }
      .mw-pop .mw-import-hint a { color: #a78bfa; cursor: pointer; }
      .mw-pop .mw-import-guide { font-size: 11px; color: #aaa; line-height: 1.5; }
      .mw-pop .mw-import-guide ol { margin: 8px 0 0; padding-left: 18px; }
      .mw-pop .mw-import-guide li { margin-bottom: 4px; }
      .mw-pop .mw-import-guide .platform-tabs {
        display: flex; gap: 6px; margin-bottom: 10px;
      }
      .mw-pop .mw-import-guide .platform-tab {
        flex: 1; padding: 6px; border-radius: 6px; font-size: 10px; font-weight: 600;
        border: 1px solid rgba(255,255,255,0.1); background: rgba(255,255,255,0.04);
        color: #888; cursor: pointer;
      }
      .mw-pop .mw-import-guide .platform-tab.active {
        background: rgba(124,58,237,0.2); border-color: rgba(124,58,237,0.4); color: #c4b5fd;
      }
      .mw-pop .mw-import-guide .platform-tab.gpt.active {
        background: rgba(16,163,127,0.15); border-color: rgba(16,163,127,0.4); color: #6ee7b7;
      }
    `
    popoverShadow.appendChild(style)
    const pop = document.createElement('div')
    pop.className = 'mw-pop'
    pop.id = 'mw-pop-inner'
    pop.innerHTML = `
      <h4 id="mw-pop-title">Improve prompt</h4>
      <div id="mw-pop-body"></div>
      <div class="actions" id="mw-pop-actions"></div>
    `
    popoverShadow.appendChild(pop)
    document.body.appendChild(host)
  }

  function positionPopover() {
    const host = document.getElementById(POPOVER_ID)
    const pop = popoverShadow && popoverShadow.getElementById('mw-pop-inner')
    if (!host || !pop) return
    const anchor = dockHost || anchoredInput
    const rect = anchor && anchor.getBoundingClientRect
      ? anchor.getBoundingClientRect()
      : { bottom: 80, right: 24, left: window.innerWidth - 380 }
    const popW = 360
    let left = Math.min(rect.left || 24, window.innerWidth - popW - 12)
    let top = (rect.top || 200) - pop.offsetHeight - 8
    if (top < 8) top = (rect.bottom || 100) + 8
    host.style.left = left + 'px'
    host.style.top = top + 'px'
  }

  function closePopover() {
    const pop = popoverShadow && popoverShadow.getElementById('mw-pop-inner')
    if (pop) {
      pop.classList.remove('open')
      pop.classList.remove('library')
    }
    popoverState.mode = 'closed'
    libraryState = { q: '', category: '', tier: '', favoritesOnly: false }
  }

  function openPopover(mode, html, actionsHtml) {
    ensurePopover()
    const pop = popoverShadow.getElementById('mw-pop-inner')
    const body = popoverShadow.getElementById('mw-pop-body')
    const actions = popoverShadow.getElementById('mw-pop-actions')
    const title = popoverShadow.getElementById('mw-pop-title')
    if (!pop || !body || !actions) return

    if (mode === 'loading') title.textContent = 'Improving...'
    else if (mode === 'clarify') title.textContent = 'Quick questions'
    else if (mode === 'import') title.textContent = 'Import your chats'
    else title.textContent = 'Review improved prompt'

    body.innerHTML = html
    actions.innerHTML = actionsHtml
    pop.classList.add('open')
    positionPopover()
    popoverState.mode = mode
  }

  async function runEngineer(message, templateName) {
    openPopover('loading', '<p class="note">Searching your memory and improving prompt...</p>', '')
    try {
      const res = await chrome.runtime.sendMessage({
        type: 'ENGINEER_PROMPT',
        message,
        template: templateName || 'none'
      })
      if (res.error) {
        const msg = res.error === 'not_logged_in'
          ? 'Sign in via the Mind World extension icon.'
          : String(res.error)
        openPopover('preview', '<p class="err">' + msg + '</p>', `
          <button class="btn-ghost" id="mw-pop-close">Close</button>
        `)
        popoverShadow.getElementById('mw-pop-close').onclick = closePopover
        return
      }
      showPreviewResult(
        res.engineeredPrompt,
        res.conversationsUsed || 0,
        message,
        templateName,
        res.sourcesUsed || []
      )
    } catch (e) {
      openPopover('preview', '<p class="err">Network error. Try again.</p>', `
        <button class="btn-ghost" id="mw-pop-close">Close</button>
      `)
      popoverShadow.getElementById('mw-pop-close').onclick = closePopover
    }
  }

  function buildSourcesHtml(sourcesUsed, conversationsUsed) {
    if (sourcesUsed && sourcesUsed.length) {
      let html = `<div class="mw-sources">
        <button type="button" class="mw-sources-toggle" id="mw-sources-toggle">Context from ${sourcesUsed.length} conversation${sourcesUsed.length > 1 ? 's' : ''} (show)</button>
        <div class="mw-sources-list" id="mw-sources-list" style="display:none;">`
      sourcesUsed.forEach(s => {
        const sim = s.similarity != null ? ` \u00b7 ${s.similarity}% match` : ''
        const src = (s.source || 'unknown').replace('chatgpt', 'ChatGPT').replace('claude', 'Claude')
        html += `<div class="mw-source-item">
          <strong>${escapeHtml(s.title)}</strong>
          <span class="mw-source-meta">${escapeHtml(src)}${sim}</span>
          ${s.preview ? `<p>${escapeHtml(s.preview)}</p>` : ''}
        </div>`
      })
      html += '</div></div>'
      return html
    }
    if (!conversationsUsed) {
      return `<p class="mw-import-hint">No past chats yet. <a id="mw-import-hint-link">Import your chat history</a> so Improve remembers what you've discussed before.</p>`
    }
    return ''
  }

  const IMPORT_STEPS = {
    chatgpt: [
      'Open chatgpt.com → click your profile (bottom-left)',
      'Settings → Data controls → Export data',
      'Check your email for the download link',
      'Click the Mind World icon in your browser → upload the .zip file'
    ],
    claude: [
      'Open claude.ai → click your initials (bottom-left)',
      'Settings → Privacy → Export data',
      'Download conversations.json',
      'Click the Mind World icon in your browser → upload the file'
    ]
  }

  function showImportGuide() {
    openPopover('import', `
      <div class="mw-import-guide">
        <p style="margin:0 0 8px;color:#ccc;font-weight:600;">Import your past AI chats (one-time, ~2 min)</p>
        <div class="platform-tabs">
          <button type="button" class="platform-tab gpt active" data-plat="chatgpt">ChatGPT</button>
          <button type="button" class="platform-tab" data-plat="claude">Claude</button>
        </div>
        <ol id="mw-import-steps">${IMPORT_STEPS.chatgpt.map(s => `<li>${s}</li>`).join('')}</ol>
      </div>
    `, `
      <button class="btn-primary" id="mw-pop-open-extension">Open Mind World to upload</button>
      <button class="btn-ghost" id="mw-pop-close">Got it</button>
    `)
    popoverShadow.querySelectorAll('.platform-tab').forEach(tab => {
      tab.onclick = () => {
        const plat = tab.dataset.plat
        popoverShadow.querySelectorAll('.platform-tab').forEach(t => t.classList.remove('active'))
        tab.classList.add('active')
        const steps = popoverShadow.getElementById('mw-import-steps')
        if (steps) steps.innerHTML = IMPORT_STEPS[plat].map(s => `<li>${s}</li>`).join('')
      }
    })
    const openExt = popoverShadow.getElementById('mw-pop-open-extension')
    if (openExt) {
      openExt.onclick = () => {
        const body = popoverShadow.getElementById('mw-pop-body')
        if (body) {
          body.innerHTML = `<p style="font-size:12px;color:#ccc;line-height:1.6;margin:0;">
            Click the <strong>🌍 Mind World icon</strong> in your browser toolbar (top-right, next to the address bar) to upload your file.
          </p>`
        }
        openExt.style.display = 'none'
        positionPopover()
      }
    }
    popoverShadow.getElementById('mw-pop-close').onclick = closePopover
    positionPopover()
  }

  function showPreviewResult(text, conversationsUsed, goal, templateName, sourcesUsed) {
    const note = conversationsUsed > 0
      ? 'Improved using your draft + past conversations below'
      : 'Engineered from your draft'
    const sourcesHtml = buildSourcesHtml(sourcesUsed, conversationsUsed)
    openPopover('preview', `
      <p class="note">${note}</p>
      ${sourcesHtml}
      <textarea id="mw-pop-preview-text" spellcheck="false"></textarea>
    `, `
      <button class="btn-primary" id="mw-pop-replace">Replace in chat</button>
      <button class="btn-ghost" id="mw-pop-close">Cancel</button>
    `)
    const ta = popoverShadow.getElementById('mw-pop-preview-text')
    if (ta) ta.value = formatEngineeredPrompt(text)
    const toggle = popoverShadow.getElementById('mw-sources-toggle')
    const list = popoverShadow.getElementById('mw-sources-list')
    if (toggle && list) {
      let sourcesOpen = false
      toggle.onclick = () => {
        sourcesOpen = !sourcesOpen
        list.style.display = sourcesOpen ? 'block' : 'none'
        const n = sourcesUsed.length
        toggle.textContent = `Context from ${n} conversation${n > 1 ? 's' : ''} (${sourcesOpen ? 'hide' : 'show'})`
      }
    }
    const importLink = popoverShadow.getElementById('mw-import-hint-link')
    if (importLink) {
      importLink.onclick = (e) => {
        e.preventDefault()
        showImportGuide()
      }
    }
    popoverShadow.getElementById('mw-pop-replace').onclick = () => {
      if (typeof injectIntoChat === 'function') injectIntoChat(ta.value, false)
      closePopover()
    }
    popoverShadow.getElementById('mw-pop-close').onclick = closePopover
    popoverState.goal = goal
    popoverState.template = templateName
    positionPopover()
  }

  async function startImprove() {
    const draft = getInputText(anchoredInput)
    if (!draft) {
      openPopover('preview', '<p class="err">Type something in the chat box first.</p>', `
        <button class="btn-ghost" id="mw-pop-close">OK</button>
      `)
      popoverShadow.getElementById('mw-pop-close').onclick = closePopover
      return
    }

    const templateName = suggestTemplateName(draft)

    if (needsClarification(draft)) {
      openPopover('loading', '<p class="note">Preparing questions...</p>', '')
      try {
        const res = await chrome.runtime.sendMessage({
          type: 'GENERATE_QUESTIONS',
          goal: draft,
          template: templateName
        })
        const questions = (res.questions || []).slice(0, 2)
        if (res.error || !questions.length) {
          await runEngineer(draft, templateName)
          return
        }
        let qHtml = '<p class="note">Your message is short — answer briefly:</p>'
        questions.forEach((q, i) => {
          qHtml += `<div class="q-block"><label>${i + 1}. ${q}</label><input type="text" id="mw-clarify-${i}" /></div>`
        })
        openPopover('clarify', qHtml, `
          <button class="btn-primary" id="mw-pop-engineer">Generate prompt</button>
          <button class="btn-ghost" id="mw-pop-skip">Skip</button>
        `)
        popoverShadow.getElementById('mw-pop-skip').onclick = () => runEngineer(draft, templateName)
        popoverShadow.getElementById('mw-pop-engineer').onclick = async () => {
          const answers = questions.map((_, i) => {
            const inp = popoverShadow.getElementById('mw-clarify-' + i)
            return inp ? inp.value.trim() : ''
          }).filter(Boolean).join('\n')
          const combined = 'Goal: ' + draft + '\n\nClarifying answers:\n' + answers
          await runEngineer(combined, templateName)
        }
        positionPopover()
      } catch (e) {
        await runEngineer(draft, templateName)
      }
    } else {
      await runEngineer(draft, templateName)
    }
  }

  async function getFavorites() {
    const stored = await chrome.storage.local.get(FAVORITES_KEY)
    return stored[FAVORITES_KEY] || []
  }

  async function toggleFavorite(name) {
    const favs = await getFavorites()
    const idx = favs.indexOf(name)
    if (idx >= 0) favs.splice(idx, 1)
    else favs.push(name)
    await chrome.storage.local.set({ [FAVORITES_KEY]: favs })
    return favs
  }

  function injectTemplate(template) {
    const body = template.template || template
    let text = typeof body === 'string' ? body : ''
    text = formatEngineeredPrompt(text)
    if (typeof injectIntoChat === 'function') injectIntoChat(text, false)
    const tName = template.name || (typeof template === 'object' ? '' : '')
    if (tName) {
      chrome.runtime.sendMessage({ type: 'TRACK_TEMPLATE_USE', name: tName }).catch(() => {})
    }
  }

  function filterTemplatesLocal(list, q, category, tier, favoritesOnly, favs) {
    let out = list.slice()
    if (category) out = out.filter(t => (t.category || '') === category)
    if (tier) out = out.filter(t => (t.tier || 'standard').toLowerCase() === tier)
    if (favoritesOnly) out = out.filter(t => favs.includes(t.name))
    if (q) {
      const needle = q.toLowerCase()
      out = out.filter(t =>
        (t.name || '').toLowerCase().includes(needle) ||
        (t.description || '').toLowerCase().includes(needle) ||
        (t.search_text || '').toLowerCase().includes(needle) ||
        (t.tags || []).some(tag => (tag || '').toLowerCase().includes(needle))
      )
    }
    out.sort((a, b) => (b.use_count || 0) - (a.use_count || 0) || (a.name || '').localeCompare(b.name || ''))
    return out
  }

  async function fetchLibraryTemplates() {
    const hasFilters = libraryState.q || libraryState.category || libraryState.tier
    if (hasFilters) {
      const res = await chrome.runtime.sendMessage({
        type: 'SEARCH_TEMPLATES',
        q: libraryState.q,
        category: libraryState.category,
        tier: libraryState.tier,
        sort: 'popular',
        limit: 80
      })
      if (res.templates && res.templates.length) return res.templates
    }
    await loadTemplates(true)
    return cachedTemplates.length ? cachedTemplates : FALLBACK_TEMPLATES
  }

  async function openLibrary() {
    ensurePopover()
    const pop = popoverShadow.getElementById('mw-pop-inner')
    if (pop) pop.classList.add('library')
    const title = popoverShadow.getElementById('mw-pop-title')
    if (title) title.textContent = 'Template Library'

    openPopover('library', '<p class="note">Loading templates...</p>', `
      <button class="btn-ghost" id="mw-pop-close">Close</button>
    `)
    popoverShadow.getElementById('mw-pop-close').onclick = closePopover

    const catRes = await chrome.runtime.sendMessage({ type: 'GET_TEMPLATE_CATEGORIES' })
    cachedCategories = catRes.categories || []

    async function renderLibrary() {
      const favs = await getFavorites()
      const list = await fetchLibraryTemplates()
      let filtered = filterTemplatesLocal(
        list,
        libraryState.q,
        libraryState.category,
        libraryState.tier,
        libraryState.favoritesOnly,
        favs
      )

      let pillsHtml = `<button type="button" class="lib-pill${!libraryState.category && !libraryState.tier && !libraryState.favoritesOnly ? ' active' : ''}" data-cat="">All</button>`
      pillsHtml += `<button type="button" class="lib-pill${libraryState.favoritesOnly ? ' active' : ''}" data-fav="1">Favorites</button>`
      pillsHtml += `<button type="button" class="lib-pill pro-pill${libraryState.tier === 'pro' ? ' active' : ''}" data-tier="pro">Pro</button>`
      cachedCategories.slice(0, 10).forEach(c => {
        const active = libraryState.category === c.category ? ' active' : ''
        pillsHtml += `<button type="button" class="lib-pill${active}" data-cat="${escapeHtml(c.category)}">${escapeHtml(c.category)} (${c.count})</button>`
      })

      let listHtml = ''
      if (!filtered.length) {
        listHtml = '<p class="lib-empty">No templates match. Try another search or category.</p>'
      } else {
        filtered.slice(0, 60).forEach(t => {
          const isPro = (t.tier || '').toLowerCase() === 'pro' || isProTemplate(t)
          const starred = favs.includes(t.name)
          listHtml += `<div class="lib-item${isPro ? ' pro' : ''}" data-name="${escapeHtml(t.name)}">
            <button type="button" class="lib-star${starred ? ' on' : ''}" data-star="${escapeHtml(t.name)}" title="Favorite">${starred ? '\u2605' : '\u2606'}</button>
            <div class="lib-item-body">
              <div class="lib-item-name">${escapeHtml(t.name)}</div>
              <div class="lib-item-desc">${escapeHtml(t.description || '')}</div>
              <div class="lib-item-meta">${escapeHtml(t.category || '')}${t.use_count ? ' \u00b7 ' + t.use_count + ' uses' : ''}</div>
            </div>
          </div>`
        })
      }

      const body = popoverShadow.getElementById('mw-pop-body')
      if (!body) return
      body.innerHTML = `
        <input type="text" class="lib-search" id="mw-lib-search" placeholder="Search templates..." value="${escapeHtml(libraryState.q)}" />
        <div class="lib-filters" id="mw-lib-filters">${pillsHtml}</div>
        <div class="lib-list" id="mw-lib-list">${listHtml}</div>
        <p class="note">${filtered.length} template${filtered.length !== 1 ? 's' : ''}</p>
      `

      const searchInput = popoverShadow.getElementById('mw-lib-search')
      let debounce = null
      if (searchInput) {
        searchInput.oninput = () => {
          clearTimeout(debounce)
          debounce = setTimeout(async () => {
            libraryState.q = searchInput.value.trim()
            await renderLibrary()
          }, 250)
        }
        searchInput.onkeydown = (e) => e.stopPropagation()
      }

      popoverShadow.querySelectorAll('.lib-pill').forEach(btn => {
        btn.onclick = async () => {
          if (btn.dataset.fav) {
            libraryState.favoritesOnly = !libraryState.favoritesOnly
            libraryState.category = ''
            libraryState.tier = ''
          } else if (btn.dataset.tier) {
            libraryState.tier = libraryState.tier === 'pro' ? '' : 'pro'
            libraryState.favoritesOnly = false
          } else {
            libraryState.category = btn.dataset.cat || ''
            libraryState.favoritesOnly = false
            libraryState.tier = ''
          }
          await renderLibrary()
        }
      })

      popoverShadow.querySelectorAll('.lib-star').forEach(btn => {
        btn.onclick = async (e) => {
          e.stopPropagation()
          await toggleFavorite(btn.dataset.star)
          await renderLibrary()
        }
      })

      popoverShadow.querySelectorAll('.lib-item').forEach(row => {
        row.onclick = () => {
          const name = row.dataset.name
          const t = filtered.find(x => x.name === name) || cachedTemplates.find(x => x.name === name)
          if (!t) return
          const isPro = (t.tier || '').toLowerCase() === 'pro' || isProTemplate(t)
          const attr = t.attribution ? '<p class="note" style="font-size:10px;">' + escapeHtml(t.attribution) + '</p>' : ''
          openPopover('preview', attr + '<textarea id="mw-pop-preview-text" spellcheck="false"></textarea>', `
            <button class="btn-primary" id="mw-pop-use">Use in chat</button>
            <button class="btn-ghost" id="mw-pop-back-lib">Back</button>
          `)
          const ta = popoverShadow.getElementById('mw-pop-preview-text')
          if (ta) ta.value = formatEngineeredPrompt(t.template || '')
          popoverShadow.getElementById('mw-pop-use').onclick = () => {
            injectTemplate(t)
            closePopover()
          }
          popoverShadow.getElementById('mw-pop-back-lib').onclick = openLibrary
          positionPopover()
        }
      })

      positionPopover()
    }

    await renderLibrary()
  }

  async function openProLibrary() {
    libraryState.tier = 'pro'
    libraryState.category = ''
    libraryState.favoritesOnly = false
    libraryState.q = ''
    await openLibrary()
  }

  function escapeHtml(text) {
    const d = document.createElement('div')
    d.textContent = text || ''
    return d.innerHTML
  }

  function buildDockUI(inputField) {
    if (inputField.parentElement && inputField.parentElement.querySelector('#' + DOCK_ID)) return

    loadTemplates()

    const dock = document.createElement('div')
    dock.id = DOCK_ID
    dock.style.cssText = `
      display: flex; flex-wrap: wrap; align-items: center; gap: 6px;
      padding: 6px 8px; margin-bottom: 6px;
      background: rgba(17,17,17,0.92);
      border: 1px solid rgba(124,58,237,0.25);
      border-radius: 8px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      z-index: 9999;
    `

    const label = document.createElement('span')
    label.textContent = 'Mind World'
    label.style.cssText = 'font-size:11px;color:#a78bfa;font-weight:600;margin-right:4px;'

    const memoryBadge = document.createElement('button')
    memoryBadge.type = 'button'
    memoryBadge.id = 'mw-memory-badge'
    memoryBadge.style.cssText = `
      font-size: 10px; padding: 2px 6px; border-radius: 10px; cursor: pointer;
      border: 1px solid rgba(255,255,255,0.1); background: rgba(255,255,255,0.05);
      color: #888; white-space: nowrap;
    `
    memoryBadge.title = 'Conversations saved to your memory'
    async function updateMemoryBadge() {
      try {
        const res = await chrome.runtime.sendMessage({ type: 'GET_MEMORY_STATS' })
        const n = res.conversationCount || 0
        if (n > 0) {
          memoryBadge.textContent = n + ' in memory'
          memoryBadge.style.color = '#6ee7b7'
          memoryBadge.style.borderColor = 'rgba(110,231,183,0.3)'
          memoryBadge.title = `${n} conversations saved — used automatically when you Improve`
        } else {
          memoryBadge.textContent = '+ Import history'
          memoryBadge.style.color = '#fcd34d'
          memoryBadge.style.borderColor = 'rgba(251,191,36,0.3)'
          memoryBadge.title = 'Import past chats for richer Improve context (click extension icon)'
        }
      } catch (e) {
        memoryBadge.textContent = ''
      }
    }
    memoryBadge.onclick = (e) => {
      e.preventDefault()
      e.stopPropagation()
      chrome.storage.local.get('mw_email', (stored) => {
        const email = stored.mw_email || ''
        window.open(
          email ? `https://mind-world.app?email=${encodeURIComponent(email)}` : 'https://mind-world.app',
          '_blank'
        )
      })
    }
    updateMemoryBadge()

    const chipsWrap = document.createElement('div')
    chipsWrap.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;flex:1;align-items:center;'

    const searchInput = document.createElement('input')
    searchInput.type = 'text'
    searchInput.placeholder = 'Search templates...'
    searchInput.title = 'Open library to search all templates'
    searchInput.style.cssText = `
      flex: 1; min-width: 100px; max-width: 180px;
      padding: 4px 8px; font-size: 11px; border-radius: 6px;
      border: 1px solid rgba(124,58,237,0.25); background: rgba(0,0,0,0.3);
      color: #e9d5ff;
    `
    searchInput.onfocus = () => {
      libraryState.q = searchInput.value.trim()
      openLibrary()
    }
    searchInput.onkeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        libraryState.q = searchInput.value.trim()
        openLibrary()
      }
    }

    async function renderChips() {
      const existing = chipsWrap.querySelectorAll('.mw-quick-chip')
      existing.forEach(el => el.remove())

      const list = cachedTemplates.length ? cachedTemplates : FALLBACK_TEMPLATES
      const draft = getInputText(anchoredInput)
      let quick = []

      if (draft.length > 10) {
        try {
          const res = await chrome.runtime.sendMessage({
            type: 'SUGGEST_TEMPLATES',
            draft,
            limit: MAX_CHIPS
          })
          if (res.templates && res.templates.length) {
            quick = res.templates
          }
        } catch (e) { /* fallback below */ }
      }

      if (!quick.length) {
        const favs = await getFavorites()
        const favTemplates = list.filter(t => favs.includes(t.name) && !isProTemplate(t))
        const standard = list.filter(t => !isProTemplate(t))
        quick = favTemplates.length
          ? favTemplates.slice(0, MAX_CHIPS)
          : standard.slice(0, MAX_CHIPS)
      }

      quick.forEach(t => {
        const chip = document.createElement('button')
        chip.type = 'button'
        chip.className = 'mw-quick-chip'
        chip.textContent = t.name.replace(/ \(.*\)$/, '').slice(0, 22)
        chip.title = (t.description || t.name)
        chip.style.cssText = `
          padding: 4px 8px; font-size: 11px; border-radius: 12px; cursor: pointer;
          border: 1px solid rgba(124,58,237,0.35); background: rgba(124,58,237,0.15);
          color: #e9d5ff; white-space: nowrap;
        `
        chip.onmouseover = () => { chip.style.background = 'rgba(124,58,237,0.35)' }
        chip.onmouseout = () => { chip.style.background = 'rgba(124,58,237,0.15)' }
        chip.onclick = () => injectTemplate(t)
        chipsWrap.appendChild(chip)
      })
    }

    chipsWrap.appendChild(searchInput)
    renderChips()
    setTimeout(renderChips, 1500)

    const improveBtn = document.createElement('button')
    improveBtn.type = 'button'
    improveBtn.textContent = 'Improve'
    improveBtn.title = 'Improve this prompt (Alt+Shift+M)'
    improveBtn.style.cssText = `
      padding: 5px 12px; font-size: 12px; font-weight: 600; border-radius: 6px;
      border: none; background: #7c3aed; color: #fff; cursor: pointer;
    `
    improveBtn.onmouseover = () => { improveBtn.style.background = '#6d28d9' }
    improveBtn.onmouseout = () => { improveBtn.style.background = '#7c3aed' }
    improveBtn.onclick = (e) => {
      e.preventDefault()
      e.stopPropagation()
      startImprove()
    }

    const libraryBtn = document.createElement('button')
    libraryBtn.type = 'button'
    libraryBtn.textContent = 'Library'
    libraryBtn.title = 'Browse and search all prompt templates'
    libraryBtn.style.cssText = `
      padding: 4px 10px; font-size: 11px; font-weight: 600; border-radius: 6px; cursor: pointer;
      border: 1px solid rgba(124,58,237,0.4); background: rgba(124,58,237,0.12); color: #c4b5fd;
    `
    libraryBtn.onclick = (e) => {
      e.preventDefault()
      e.stopPropagation()
      libraryState = { q: '', category: '', tier: '', favoritesOnly: false }
      openLibrary()
    }

    dock.appendChild(label)
    dock.appendChild(memoryBadge)
    dock.appendChild(chipsWrap)
    dock.appendChild(libraryBtn)
    dock.appendChild(improveBtn)

    const parent = inputField.parentElement
    if (parent) {
      parent.insertBefore(dock, inputField)
      dockHost = dock
    } else {
      inputField.insertAdjacentElement('beforebegin', dock)
      dockHost = dock
    }
  }

  window.injectPromptBuilderButton = function (inputField) {
    if (!inputField || inputField._mwDockAttached) return
    inputField._mwDockAttached = true
    anchoredInput = inputField
    buildDockUI(inputField)
  }

  document.addEventListener('keydown', (e) => {
    if (e.altKey && e.shiftKey && e.key.toLowerCase() === 'm') {
      e.preventDefault()
      startImprove()
    }
  })

  document.addEventListener('click', (e) => {
    const host = document.getElementById(POPOVER_ID)
    if (!host || popoverState.mode === 'closed') return
    const path = e.composedPath && e.composedPath()
    if (path && path.includes(host)) return
    if (dockHost && dockHost.contains(e.target)) return
    closePopover()
  })
})()
