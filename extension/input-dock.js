// Mind World — input-adjacent UI (template chips + Improve popover)
// Loaded after content.js; uses findInputField() and injectIntoChat() from content.js

(function () {
  const DOCK_ID = 'mw-input-dock'
  const POPOVER_ID = 'mw-improve-popover-host'
  const MAX_CHIPS = 3
  const FAVORITES_KEY = 'mw_template_favorites'
  const USAGE_KEY = 'mw_template_usage'

  let cachedTemplates = []
  let cachedCategories = []
  let libraryState = { intent: '', category: '', tier: '', favoritesOnly: false, sort: 'popular' }
  let chipsDebounce = null
  let chipsRequestId = 0
  let refreshDockChips = null
  let lastImproveTelemetry = null
  let engineerRequestId = 0
  let improveInFlight = false
  let popoverEventsBound = false
  let improveBtnEl = null
  const IMPROVE_BTN_LABEL = 'Improve'

  function loadingBodyHtml(message) {
    return `<div class="mw-loading"><span class="mw-spinner" aria-hidden="true"></span><p class="note">${escapeHtml(message)}</p></div>`
  }

  async function getImproveLoadingMessage() {
    const stored = await chrome.storage.local.get(['mw_memory_enabled'])
    const memoryOn = stored.mw_memory_enabled !== false
    return memoryOn ? 'Searching your memory and improving prompt…' : 'Improving your prompt…'
  }

  function setImproveButtonBusy(busy) {
    if (!improveBtnEl) return
    improveBtnEl.disabled = !!busy
    improveBtnEl.style.opacity = busy ? '0.65' : '1'
    improveBtnEl.style.cursor = busy ? 'wait' : 'pointer'
    improveBtnEl.textContent = busy ? 'Improving…' : IMPROVE_BTN_LABEL
  }

  async function hashText(input) {
    try {
      const text = String(input || '')
      const enc = new TextEncoder().encode(text)
      const digest = await crypto.subtle.digest('SHA-256', enc)
      return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('')
    } catch (e) {
      return ''
    }
  }

  function levenshteinDistance(a, b, maxChars = 1200) {
    const left = String(a || '').slice(0, maxChars)
    const right = String(b || '').slice(0, maxChars)
    const m = left.length
    const n = right.length
    if (!m) return n
    if (!n) return m
    const prev = new Array(n + 1)
    const curr = new Array(n + 1)
    for (let j = 0; j <= n; j++) prev[j] = j
    for (let i = 1; i <= m; i++) {
      curr[0] = i
      const li = left.charCodeAt(i - 1)
      for (let j = 1; j <= n; j++) {
        const cost = li === right.charCodeAt(j - 1) ? 0 : 1
        curr[j] = Math.min(
          prev[j] + 1,
          curr[j - 1] + 1,
          prev[j - 1] + cost
        )
      }
      for (let j = 0; j <= n; j++) prev[j] = curr[j]
    }
    return prev[n]
  }

  async function emitPromptEditFeedback(payload) {
    try {
      await chrome.runtime.sendMessage({
        type: 'PROMPT_EDIT_FEEDBACK',
        ...payload
      })
    } catch (e) { /* telemetry best-effort */ }
  }

  function formatEngineeredPrompt(text) {
    if (!text) return ''
    let s = text.trim()
    s = s.replace(/\n*---+\n*/g, '\n\n')
    s = s.replace(/^---+\s*|\s*---+$/g, '')
    s = s.replace(/\*\*([^*]+)\*\*/g, '$1')
    s = s.replace(/[ \t]+/g, ' ')
    s = s.replace(/\n{3,}/g, '\n\n')
    return s.trim()
  }

  window.formatEngineeredPrompt = formatEngineeredPrompt

  function bindPopoverClose() {
    const btn = popoverShadow && popoverShadow.getElementById('mw-pop-close')
    if (btn) btn.onclick = closePopover
  }

  function friendlyEngineerError(err) {
    const code = String(err || '').trim()
    if (!code) return 'Something went wrong. Try again.'
    if (code === 'not_logged_in') return 'Sign in via the Mind World extension icon.'
    if (code === 'quota_exceeded') {
      return "You've used all 25 free Improve calls. Add your own Anthropic API key in the extension settings for unlimited use."
    }
    if (code === 'auth_required') {
      return 'Session expired. Open the Mind World extension and sign in again.'
    }
    if (code === 'extension_unreachable' || code === 'empty_response') {
      return 'Extension connection lost. Reload Mind World at chrome://extensions, then refresh this page.'
    }
    if (/message port closed|receiving end does not exist|extension context invalidated/i.test(code)) {
      return 'Extension connection lost. Reload Mind World at chrome://extensions, then refresh this page.'
    }
    return code
  }

  async function sendRuntimeMessage(payload) {
    const res = await chrome.runtime.sendMessage(payload)
    if (res == null) return { error: 'extension_unreachable' }
    return res
  }

  let dockHost = null
  let popoverShadow = null
  let anchoredInput = null
  let popoverState = { mode: 'closed', template: 'none', goal: '' }

  // Which past chats fed the current Improve result, and which the user has
  // kept ticked. `pool` is held client-side (not re-read from the response) so
  // a chat the user unticks stays visible and re-tickable after a regenerate.
  let sourcePicker = { pool: [], selected: new Set(), open: true, searchOpen: false, appliedKey: '' }

  // Server's explanation for why memory contributed nothing — see /engineer_prompt.
  let lastMemoryStatus = null

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
    const existing = document.getElementById(POPOVER_ID)
    if (existing) {
      if (!popoverShadow) popoverShadow = existing.shadowRoot
      bindPopoverEventIsolation()
      return
    }
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
      /* The sources picker expands the preview body — keep it inside the viewport. */
      .mw-pop #mw-pop-body { max-height: 68vh; overflow-y: auto; }
      .mw-pop h4 { margin: 0; font-size: 13px; font-weight: 600; color: #c4b5fd; }
      .mw-pop .note { font-size: 11px; color: #888; text-align: center; margin: 0; }
      .mw-loading { display: flex; align-items: center; gap: 10px; justify-content: center; }
      .mw-spinner {
        width: 16px; height: 16px; border: 2px solid rgba(124,58,237,0.25);
        border-top-color: #a78bfa; border-radius: 50%;
        animation: mw-spin 0.7s linear infinite; flex-shrink: 0;
      }
      @keyframes mw-spin { to { transform: rotate(360deg); } }
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
      .mw-pop .q-chip {
        padding: 4px 10px; border-radius: 999px; font-size: 11px; cursor: pointer;
        border: 1px solid rgba(255,255,255,0.2); background: rgba(255,255,255,0.04); color: #ddd;
        pointer-events: auto;
      }
      .mw-pop .q-chip.active {
        border-color: rgba(124,58,237,0.6); background: rgba(124,58,237,0.25); color: #f3e8ff;
      }
      .mw-pop .mw-confirm-summary {
        font-size: 13px;
        color: #ddd;
        line-height: 1.5;
        margin: 0;
      }
      .mw-pop .mw-correction-row {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin-top: 8px;
      }
      .mw-pop .actions { display: flex; gap: 8px; flex-wrap: wrap; }
      .mw-pop button {
        flex: 1; min-width: 90px;
        padding: 8px 10px; border-radius: 6px; border: none;
        font-size: 12px; font-weight: 600; cursor: pointer;
        pointer-events: auto;
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
      .mw-pop .lib-sort {
        display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
      }
      .mw-pop .lib-sort-label {
        font-size: 10px; color: #666; margin-right: 2px;
      }
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
      .mw-pop .lib-item-reason { font-size: 10px; color: #a78bfa; margin-top: 3px; }
      .mw-pop .lib-section-label {
        font-size: 10px; font-weight: 600; color: #a78bfa;
        text-transform: uppercase; letter-spacing: 0.04em; margin: 4px 0 2px;
      }
      .mw-pop .lib-loading { font-size: 11px; color: #888; text-align: center; padding: 20px; }
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
        margin-top: 8px; max-height: 200px; overflow-y: auto;
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
      .mw-pop .mw-source-item.off { opacity: 0.45; background: rgba(255,255,255,0.03); border-color: rgba(255,255,255,0.08); }
      .mw-pop .mw-source-row { display: flex; align-items: flex-start; gap: 8px; }
      .mw-pop .mw-source-row input[type="checkbox"] {
        margin: 2px 0 0; accent-color: #7c3aed; cursor: pointer; flex-shrink: 0;
      }
      .mw-pop .mw-source-row label { cursor: pointer; flex: 1; min-width: 0; }
      .mw-pop .mw-sources-actions {
        display: flex; align-items: center; gap: 10px; margin-top: 8px; flex-wrap: wrap;
      }
      .mw-pop .mw-sources-link {
        background: none; border: none; color: #a78bfa; font-size: 11px;
        cursor: pointer; padding: 0; text-decoration: underline;
      }
      .mw-pop .mw-sources-link:hover { color: #c4b5fd; }
      .mw-pop .mw-regen-btn {
        background: rgba(124,58,237,0.25); border: 1px solid rgba(124,58,237,0.5);
        color: #e9d5ff; font-size: 11px; font-weight: 600; border-radius: 6px;
        padding: 4px 10px; cursor: pointer;
      }
      .mw-pop .mw-regen-btn:hover { background: rgba(124,58,237,0.4); }
      .mw-pop .mw-regen-btn[disabled] { opacity: 0.4; cursor: default; }
      .mw-pop .mw-source-search { margin-top: 8px; }
      .mw-pop .mw-source-search input[type="text"] {
        width: 100%; box-sizing: border-box; font-size: 11px; color: #eee;
        background: rgba(255,255,255,0.05); border: 1px solid rgba(124,58,237,0.35);
        border-radius: 6px; padding: 5px 8px; outline: none;
      }
      .mw-pop .mw-source-search input[type="text"]::placeholder { color: #777; }
      .mw-pop .mw-source-results { margin-top: 6px; display: flex; flex-direction: column; gap: 4px; max-height: 120px; overflow-y: auto; }
      .mw-pop .mw-source-result {
        text-align: left; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08);
        border-radius: 6px; padding: 5px 8px; font-size: 11px; color: #ddd; cursor: pointer;
      }
      .mw-pop .mw-source-result:hover { border-color: rgba(124,58,237,0.5); background: rgba(124,58,237,0.12); }
      .mw-pop .mw-source-result[disabled] { opacity: 0.4; cursor: default; }
      .mw-pop .mw-source-result span { display: block; color: #666; font-size: 10px; }
      .mw-pop .mw-source-status { font-size: 10px; color: #888; margin: 6px 0 0; }
      .mw-pop .mw-import-hint { font-size: 11px; color: #888; }
      .mw-pop .mw-import-hint a { color: #a78bfa; cursor: pointer; }
      .mw-pop .mw-compare-toggle {
        background: none; border: none; color: #a78bfa; cursor: pointer;
        font-size: 11px; padding: 0; text-align: left; align-self: flex-start;
      }
      .mw-pop .mw-compare-toggle:hover { color: #c4b5fd; text-decoration: underline; }
      .mw-pop .mw-original {
        font-size: 11px; color: #999; line-height: 1.4; margin: 0;
        padding: 8px 10px; border-left: 2px solid rgba(124,58,237,0.4);
        background: rgba(124,58,237,0.06); border-radius: 4px;
        white-space: pre-wrap; word-break: break-word;
      }
      .mw-pop .mw-diff-cta-btn {
        width: 100%; box-sizing: border-box; cursor: pointer;
        background: linear-gradient(90deg, rgba(124,58,237,0.25), rgba(236,72,153,0.25));
        border: 1px solid rgba(167,139,250,0.5); color: #e9d5ff;
        font-size: 12px; font-weight: 600; padding: 9px 12px; border-radius: 8px;
        margin-bottom: 4px;
      }
      .mw-pop .mw-diff-cta-btn:hover {
        border-color: rgba(167,139,250,0.9);
        background: linear-gradient(90deg, rgba(124,58,237,0.4), rgba(236,72,153,0.4));
      }
      .mw-pop.compare { width: 680px; max-width: 92vw; max-height: 80vh; }
      .mw-pop .mw-compare-model-note {
        font-size: 10px; color: #8b8b96; text-align: center; margin: -2px 0 2px;
        line-height: 1.4;
      }
      .mw-pop .mw-compare-model-note strong { color: #a78bfa; font-weight: 600; }
      .mw-pop .mw-compare-grid {
        display: grid; grid-template-columns: 1fr 1fr; gap: 10px;
        overflow-y: auto; max-height: 62vh; padding-right: 2px;
      }
      .mw-pop .mw-compare-col {
        display: flex; flex-direction: column; gap: 6px;
        border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; padding: 10px;
      }
      .mw-pop .mw-compare-col-improved {
        border-color: rgba(167,139,250,0.45);
        background: rgba(124,58,237,0.06);
      }
      .mw-pop .mw-compare-head { font-size: 12px; font-weight: 700; }
      .mw-pop .mw-compare-head-raw { color: #9ca3af; }
      .mw-pop .mw-compare-head-improved { color: #c4b5fd; }
      .mw-pop .mw-compare-prompt {
        font-size: 10px; color: #888; line-height: 1.4; white-space: pre-wrap;
        word-break: break-word; padding: 6px 8px; border-radius: 4px;
        background: rgba(255,255,255,0.03); max-height: 120px; overflow-y: auto;
      }
      .mw-pop .mw-compare-answer-label {
        font-size: 9px; text-transform: uppercase; letter-spacing: 0.05em; color: #666;
      }
      .mw-pop .mw-compare-answer {
        font-size: 11px; color: #ddd; line-height: 1.45; white-space: pre-wrap;
        word-break: break-word;
      }
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
    bindPopoverEventIsolation()
  }

  function bindPopoverEventIsolation() {
    if (!popoverShadow) return
    const stop = (e) => e.stopPropagation()
    const events = ['keydown', 'keyup', 'input', 'mousedown', 'click', 'pointerdown']
    if (popoverEventsBound && popoverShadow._mwStopProp) {
      events.forEach((evt) => {
        popoverShadow.removeEventListener(evt, popoverShadow._mwStopProp, true)
        popoverShadow.removeEventListener(evt, popoverShadow._mwStopProp, false)
      })
    }
    popoverShadow._mwStopProp = stop
    events.forEach((evt) => popoverShadow.addEventListener(evt, stop, false))
    popoverEventsBound = true
  }

  function bindDockControl(el, onClick) {
    if (!el) return
    const stop = (e) => {
      e.preventDefault()
      e.stopPropagation()
    }
    el.addEventListener('mousedown', stop)
    el.addEventListener('click', (e) => {
      stop(e)
      onClick(e)
    })
  }

  async function continueImproveFlow(draft, templateName) {
    await runEngineer(draft, templateName, { originalDraft: draft })
  }

  function bindPreviewTextarea(ta) {
    if (!ta || ta._mwPreviewBound) return
    ta._mwPreviewBound = true
    const stop = (e) => e.stopPropagation()
    ;['keydown', 'keyup', 'keypress', 'input', 'mousedown', 'click', 'pointerdown'].forEach((evt) => {
      ta.addEventListener(evt, stop)
    })
  }

  function positionPopover() {
    const host = document.getElementById(POPOVER_ID)
    const pop = popoverShadow && popoverShadow.getElementById('mw-pop-inner')
    if (!host || !pop) return
    const anchor = dockHost || anchoredInput
    const rect = anchor && anchor.getBoundingClientRect
      ? anchor.getBoundingClientRect()
      : { bottom: 80, right: 24, left: window.innerWidth - 380 }
    const popW = Math.min(pop.offsetWidth || 440, window.innerWidth - 24)
    const anchorIsSideRail = !!(dockHost && dockHost.dataset && dockHost.dataset.mwDockMode === 'side')
    let left
    let top

    if (anchorIsSideRail) {
      left = (rect.left || window.innerWidth - 72) - popW - 10
      top = (rect.top || 120) + (((rect.height || 0) - pop.offsetHeight) / 2)
      if (left < 8) left = 8
    } else {
      left = Math.min(rect.left || 24, window.innerWidth - popW - 12)
      top = (rect.top || 200) - pop.offsetHeight - 8
      if (top < 8) top = (rect.bottom || 100) + 8
    }

    if (top < 8) top = 8
    if (top + pop.offsetHeight > window.innerHeight - 8) {
      top = Math.max(8, window.innerHeight - pop.offsetHeight - 8)
    }
    host.style.left = left + 'px'
    host.style.top = top + 'px'
  }

  function closePopover() {
    const pop = popoverShadow && popoverShadow.getElementById('mw-pop-inner')
    if (pop) {
      pop.classList.remove('open')
      pop.classList.remove('library')
      pop.classList.remove('compare')
    }
    popoverState.mode = 'closed'
    improveInFlight = false
    setImproveButtonBusy(false)
    libraryState = { intent: '', category: '', tier: '', favoritesOnly: false, sort: libraryState.sort || 'popular' }
  }

  function openPopover(mode, html, actionsHtml) {
    ensurePopover()
    const pop = popoverShadow.getElementById('mw-pop-inner')
    const body = popoverShadow.getElementById('mw-pop-body')
    const actions = popoverShadow.getElementById('mw-pop-actions')
    const title = popoverShadow.getElementById('mw-pop-title')
    if (!pop || !body || !actions) return

    if (mode === 'loading') title.textContent = 'Improving...'
    else if (mode === 'confirm') title.textContent = 'Quick check'
    else if (mode === 'import') title.textContent = 'Import your chats'
    else title.textContent = 'Review improved prompt'

    body.innerHTML = html
    actions.innerHTML = actionsHtml
    pop.classList.add('open')
    positionPopover()
    popoverState.mode = mode
  }

  async function runEngineer(message, templateName, metadata = {}, options = {}) {
    const requestId = ++engineerRequestId
    const requestStartedAt = Date.now()
    // `conversationIds` present = user picked the chats by hand. An empty array
    // means "use none of them", which the backend expresses as skip_memory.
    const manualIds = Array.isArray(options.conversationIds) ? options.conversationIds : null
    improveInFlight = true
    setImproveButtonBusy(true)
    const loadingMsg = manualIds
      ? 'Rewriting with the chats you picked…'
      : await getImproveLoadingMessage()
    openPopover('loading', loadingBodyHtml(loadingMsg), '')
    try {
      const req = {
        type: 'ENGINEER_PROMPT',
        message,
        template: templateName || 'none',
        platform: location.hostname
      }
      if (manualIds) {
        if (manualIds.length) req.conversationIds = manualIds
        else req.skipMemory = true
      }
      const res = await sendRuntimeMessage(req)
      if (requestId !== engineerRequestId) return
      if (res.error) {
        improveInFlight = false
        setImproveButtonBusy(false)
        if (res.error === 'quota_exceeded') {
          openPopover('preview', `
            <p style="font-size:13px;font-weight:600;color:#f9a8d4;margin:0;">You've used all 25 free Improve calls</p>
            <p style="font-size:12px;color:#aaa;margin:6px 0 0;">Add your own Anthropic API key in the extension settings for unlimited use — it takes 30 seconds.</p>
          `, `
            <button class="btn-primary" id="mw-pop-upgrade">Add API key (free)</button>
            <button class="btn-ghost" id="mw-pop-close">Maybe later</button>
          `)
          popoverShadow.getElementById('mw-pop-upgrade').onclick = () => {
            chrome.runtime.sendMessage({ type: 'OPEN_POPUP' }).catch(() => {})
            closePopover()
          }
        } else {
          const msg = friendlyEngineerError(res.error)
          openPopover('preview', '<p class="err">' + escapeHtml(msg) + '</p>', `
            <button class="btn-ghost" id="mw-pop-close">Close</button>
          `)
        }
        bindPopoverClose()
        return
      }
      emitPromptEditFeedback({
        eventType: 'improve_request',
        rating: 1,
        acceptedUnedited: false,
        edited: false,
        latencyMs: res.latencyMs || (Date.now() - requestStartedAt),
        conversationsUsed: res.conversationsUsed || 0,
        diffMetrics: {
          clarification_count: metadata.clarificationCount || 0,
          conversations_used: res.conversationsUsed || 0,
          memory_status: (res.memory && res.memory.status) || null
        }
      })
      const returnedSources = res.sourcesUsed || []
      if (manualIds) {
        // Keep the full pool so unticked chats stay listed; merge in anything
        // the response knows more about (e.g. a title we only had partially).
        returnedSources.forEach(s => {
          const i = sourcePicker.pool.findIndex(p => String(p.id) === String(s.id))
          if (i >= 0) sourcePicker.pool[i] = Object.assign({}, sourcePicker.pool[i], s)
          else sourcePicker.pool.push(s)
        })
        sourcePicker.selected = new Set(manualIds.map(String))
      } else {
        sourcePicker = {
          pool: returnedSources.slice(),
          selected: new Set(returnedSources.map(s => String(s.id))),
          open: sourcePicker.open,
          searchOpen: false
        }
      }
      // Snapshot of what actually produced the prompt on screen — the
      // Regenerate button only lights up once the ticks drift from this.
      sourcePicker.appliedKey = selectionKey(sourcePicker.selected)
      lastMemoryStatus = res.memory || null
      showPreviewResult(
        res.engineeredPrompt,
        res.conversationsUsed || 0,
        message,
        templateName,
        sourcePicker.pool,
        {
          startedAt: requestStartedAt,
          latencyMs: res.latencyMs || (Date.now() - requestStartedAt),
          clarificationCount: metadata.clarificationCount || 0,
          originalDraft: metadata.originalDraft || message
        }
      )
    } catch (e) {
      if (requestId !== engineerRequestId) return
      improveInFlight = false
      setImproveButtonBusy(false)
      const msg = friendlyEngineerError(e && e.message)
      openPopover('preview', '<p class="err">' + escapeHtml(msg) + '</p>', `
        <button class="btn-ghost" id="mw-pop-close">Close</button>
      `)
      bindPopoverClose()
    } finally {
      if (requestId === engineerRequestId && popoverState.mode !== 'preview' && popoverState.mode !== 'confirm') {
        improveInFlight = false
        setImproveButtonBusy(false)
      }
    }
  }

  function selectionKey(set) {
    return Array.from(set).sort().join('|')
  }

  function sourceLabel(source) {
    const s = String(source || '').toLowerCase()
    if (s.includes('chatgpt') || s.includes('openai')) return 'ChatGPT'
    if (s.includes('claude')) return 'Claude'
    if (s.includes('gemini')) return 'Gemini'
    if (s.includes('perplexity')) return 'Perplexity'
    return source ? String(source) : 'Saved chat'
  }

  function sourcesToggleLabel(open) {
    const total = sourcePicker.pool.length
    const picked = sourcePicker.selected.size
    const noun = `past chat${total === 1 ? '' : 's'}`
    const count = picked === total ? `${total}` : `${picked} of ${total}`
    return `✨ Using ${count} ${noun} (${open ? 'hide' : 'show'})`
  }

  function sourceItemHtml(s) {
    const checked = sourcePicker.selected.has(String(s.id))
    const sim = s.similarity != null ? ` · ${s.similarity}% match` : ''
    const date = s.created_at ? ` · ${escapeHtml(String(s.created_at).slice(0, 10))}` : ''
    const id = escapeHtml(String(s.id))
    const preview = (s.preview || '').replace(/\[human\]|\[assistant\]/g, '').trim()
    return `<div class="mw-source-item${checked ? '' : ' off'}" data-src-id="${id}">
      <div class="mw-source-row">
        <input type="checkbox" data-src-check="${id}"${checked ? ' checked' : ''}>
        <label>
          <strong>${escapeHtml(s.title || 'Untitled')}</strong>
          <span class="mw-source-meta">${escapeHtml(sourceLabel(s.source))}${sim}${date}</span>
          ${preview ? `<p>${escapeHtml(preview)}</p>` : ''}
        </label>
      </div>
    </div>`
  }

  function buildSourcesHtml(sourcesUsed, conversationsUsed) {
    if (sourcesUsed && sourcesUsed.length) {
      const open = sourcePicker.open !== false
      const hide = open ? '' : ' style="display:none;"'
      return `<div class="mw-sources">
        <button type="button" class="mw-sources-toggle" id="mw-sources-toggle">${sourcesToggleLabel(open)}</button>
        <div class="mw-sources-list" id="mw-sources-list"${hide}>
          ${sourcesUsed.map(sourceItemHtml).join('')}
        </div>
        <div class="mw-sources-actions" id="mw-sources-actions"${hide}>
          <button type="button" class="mw-sources-link" id="mw-sources-add">+ Add another chat</button>
          <button type="button" class="mw-regen-btn" id="mw-sources-regen" disabled>Rewrite with these chats</button>
        </div>
        <div class="mw-source-search" id="mw-source-search" style="display:none;">
          <input type="text" id="mw-source-search-input" placeholder="Search your past chats…" spellcheck="false">
          <div class="mw-source-results" id="mw-source-results"></div>
        </div>
      </div>`
    }
    if (!conversationsUsed) {
      return emptyMemoryHtml()
    }
    return ''
  }

  // The old copy always blamed a missing import, which is wrong (and alarming)
  // for someone with hundreds of chats stored. Say what actually happened.
  function emptyMemoryHtml() {
    const m = lastMemoryStatus || {}
    const stored = m.stored_conversations
    if (m.status === 'skipped') {
      return `<p class="mw-import-hint">Memory is turned off, so this was engineered from your draft alone. Turn it back on in the Mind World popup.</p>`
    }
    if (m.status === 'not_indexed') {
      return `<p class="mw-import-hint">You have ${stored} chats stored but none are searchable yet — their embeddings are missing, so nothing can be matched. Re-import your history to rebuild the index.</p>`
    }
    if (m.status === 'no_match') {
      return `<div class="mw-sources">
        <p class="mw-import-hint">None of your ${stored} stored chats were close enough to this draft.</p>
        <div class="mw-sources-list" id="mw-sources-list"></div>
        <div class="mw-sources-actions">
          <button type="button" class="mw-sources-link" id="mw-sources-add">+ Pick a chat yourself</button>
          <button type="button" class="mw-regen-btn" id="mw-sources-regen" disabled>Rewrite with these chats</button>
        </div>
        <div class="mw-source-search" id="mw-source-search" style="display:none;">
          <input type="text" id="mw-source-search-input" placeholder="Search your past chats…" spellcheck="false">
          <div class="mw-source-results" id="mw-source-results"></div>
        </div>
      </div>`
    }
    return `<p class="mw-import-hint">No past chats yet. <a id="mw-import-hint-link">Import your chat history</a> so Improve remembers what you've discussed before.</p>`
  }

  function bindSourcePicker(goal, templateName) {
    const toggle = popoverShadow.getElementById('mw-sources-toggle')
    const list = popoverShadow.getElementById('mw-sources-list')
    const actions = popoverShadow.getElementById('mw-sources-actions')
    const regen = popoverShadow.getElementById('mw-sources-regen')
    const addBtn = popoverShadow.getElementById('mw-sources-add')
    const searchBox = popoverShadow.getElementById('mw-source-search')
    const searchInput = popoverShadow.getElementById('mw-source-search-input')
    const resultsBox = popoverShadow.getElementById('mw-source-results')
    // The "nothing matched" state renders the search + rewrite controls without
    // a list or toggle, so every block below has to stand on its own.
    if (!toggle && !addBtn) return

    function refreshControls() {
      if (toggle) toggle.textContent = sourcesToggleLabel(sourcePicker.open !== false)
      if (!regen) return
      const changed = selectionKey(sourcePicker.selected) !== sourcePicker.appliedKey
      regen.disabled = !changed
      regen.textContent = sourcePicker.selected.size === 0
        ? 'Rewrite without past chats'
        : 'Rewrite with these chats'
    }

    function bindCheckboxes() {
      if (!list) return
      list.querySelectorAll('input[data-src-check]').forEach(cb => {
        cb.onchange = () => {
          const id = cb.getAttribute('data-src-check')
          if (cb.checked) sourcePicker.selected.add(id)
          else sourcePicker.selected.delete(id)
          const item = cb.closest('.mw-source-item')
          if (item) item.classList.toggle('off', !cb.checked)
          refreshControls()
        }
      })
    }

    function renderList() {
      if (list) list.innerHTML = sourcePicker.pool.map(sourceItemHtml).join('')
      bindCheckboxes()
      refreshControls()
      positionPopover()
    }

    bindCheckboxes()
    refreshControls()

    if (toggle && list) {
      toggle.onclick = () => {
        sourcePicker.open = sourcePicker.open === false
        const shown = sourcePicker.open !== false
        list.style.display = shown ? 'flex' : 'none'
        if (actions) actions.style.display = shown ? 'flex' : 'none'
        if (!shown && searchBox) {
          searchBox.style.display = 'none'
          sourcePicker.searchOpen = false
        }
        refreshControls()
        positionPopover()
      }
    }

    if (addBtn && searchBox && searchInput && resultsBox) {
      addBtn.onclick = () => {
        sourcePicker.searchOpen = !sourcePicker.searchOpen
        searchBox.style.display = sourcePicker.searchOpen ? 'block' : 'none'
        if (sourcePicker.searchOpen) setTimeout(() => searchInput.focus(), 0)
        positionPopover()
      }

      let searchTimer = null
      let searchSeq = 0
      searchInput.oninput = () => {
        const q = searchInput.value.trim()
        clearTimeout(searchTimer)
        if (q.length < 2) {
          resultsBox.innerHTML = ''
          positionPopover()
          return
        }
        const seq = ++searchSeq
        resultsBox.innerHTML = '<p class="mw-source-status">Searching…</p>'
        searchTimer = setTimeout(async () => {
          let res = null
          try {
            res = await sendRuntimeMessage({ type: 'SEARCH', query: q })
          } catch (e) { /* offline or worker asleep — treated as no results */ }
          if (seq !== searchSeq) return
          const results = (res && res.results) || []
          if (!results.length) {
            resultsBox.innerHTML = '<p class="mw-source-status">No matching chats.</p>'
            positionPopover()
            return
          }
          resultsBox.innerHTML = results.map(r => {
            const already = sourcePicker.pool.some(p => String(p.id) === String(r.id))
            const sim = r.similarity != null ? ` · ${Math.round(r.similarity * 100)}% match` : ''
            return `<button type="button" class="mw-source-result" data-add-id="${escapeHtml(String(r.id))}"${already ? ' disabled' : ''}>
              ${escapeHtml(r.title || 'Untitled')}
              <span>${escapeHtml(sourceLabel(r.source))}${sim}${already ? ' · already added' : ''}</span>
            </button>`
          }).join('')
          resultsBox.querySelectorAll('button[data-add-id]').forEach(btn => {
            btn.onclick = () => {
              const id = btn.getAttribute('data-add-id')
              const found = results.find(r => String(r.id) === id)
              if (!found) return
              sourcePicker.pool.push({
                id: found.id,
                title: found.title,
                preview: (found.preview || '').slice(0, 120),
                source: found.source,
                created_at: found.created_at,
                similarity: found.similarity != null ? Math.round(found.similarity * 1000) / 10 : null
              })
              sourcePicker.selected.add(String(id))
              btn.disabled = true
              renderList()
            }
          })
          positionPopover()
        }, 350)
      }
    }

    if (regen) {
      regen.onclick = () => {
        if (regen.disabled) return
        runEngineer(goal, templateName, { originalDraft: goal }, {
          conversationIds: Array.from(sourcePicker.selected)
        })
      }
    }
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

  function showPreviewResult(text, conversationsUsed, goal, templateName, sourcesUsed, telemetry) {
    const note = conversationsUsed > 0
      ? 'Improved using your draft + past conversations below'
      : 'Engineered from your draft'
    const sourcesHtml = buildSourcesHtml(sourcesUsed, conversationsUsed)
    const originalDraft = (goal || '').trim()
    const compareHtml = originalDraft
      ? `<button type="button" class="mw-compare-toggle" id="mw-compare-toggle">See your original</button>
         <div class="mw-original" id="mw-original" style="display:none;">${escapeHtml(originalDraft)}</div>`
      : ''
    openPopover('preview', `
      <div id="mw-diff-cta"></div>
      <p class="note">${note}</p>
      ${compareHtml}
      ${sourcesHtml}
      <textarea id="mw-pop-preview-text" spellcheck="false"></textarea>
    `, `
      <button class="btn-primary" id="mw-pop-replace">Replace in chat</button>
      <button class="btn-ghost" id="mw-pop-close">Cancel</button>
    `)
    const ta = popoverShadow.getElementById('mw-pop-preview-text')
    if (ta) {
      ta.value = formatEngineeredPrompt(text)
      bindPreviewTextarea(ta)
      setTimeout(() => { ta.focus() }, 0)
    }
    lastImproveTelemetry = {
        startedAt: telemetry && telemetry.startedAt ? telemetry.startedAt : Date.now(),
        latencyMs: telemetry && telemetry.latencyMs ? telemetry.latencyMs : 0,
        clarificationCount: telemetry && telemetry.clarificationCount ? telemetry.clarificationCount : 0,
        usedFreeText: !!(telemetry && telemetry.usedFreeText),
        originalDraft: (telemetry && telemetry.originalDraft) ? telemetry.originalDraft : goal,
        engineeredPrompt: formatEngineeredPrompt(text)
      }
    const compareToggle = popoverShadow.getElementById('mw-compare-toggle')
    const originalBox = popoverShadow.getElementById('mw-original')
    if (compareToggle && originalBox) {
      let originalOpen = false
      compareToggle.onclick = () => {
        originalOpen = !originalOpen
        originalBox.style.display = originalOpen ? 'block' : 'none'
        compareToggle.textContent = originalOpen ? 'Hide your original' : 'See your original'
      }
    }
    bindSourcePicker(goal, templateName)
    const importLink = popoverShadow.getElementById('mw-import-hint-link')
    if (importLink) {
      importLink.onclick = (e) => {
        e.preventDefault()
        showImportGuide()
      }
    }
    popoverShadow.getElementById('mw-pop-replace').onclick = async () => {
      const editedPrompt = ta ? ta.value : ''
      if (typeof injectIntoChat === 'function') injectIntoChat(editedPrompt, false)
      const engineered = (lastImproveTelemetry && lastImproveTelemetry.engineeredPrompt) || ''
      const distance = levenshteinDistance(engineered, editedPrompt)
      const maxLen = Math.max(engineered.length, editedPrompt.length, 1)
      const normDistance = distance / maxLen
      const acceptedUnedited = distance === 0
      const payload = {
        eventType: 'edit_feedback',
        rating: acceptedUnedited ? 1 : -1,
        templateUsed: templateName || 'none',
        conversationsUsed: conversationsUsed || 0,
        goalHash: await hashText(goal || ''),
        engineeredPromptHash: await hashText(engineered),
        finalPromptHash: await hashText(editedPrompt),
        engineeredPromptPreview: engineered.slice(0, 2500),
        finalPromptPreview: editedPrompt.slice(0, 2500),
        edited: !acceptedUnedited,
        acceptedUnedited,
        latencyMs: (lastImproveTelemetry && lastImproveTelemetry.latencyMs) || 0,
        diffMetrics: {
          engineered_length: engineered.length,
          final_length: editedPrompt.length,
          edit_distance: distance,
          normalized_edit_distance: Number(normDistance.toFixed(6)),
          clarification_count: (lastImproveTelemetry && lastImproveTelemetry.clarificationCount) || 0,
          clarification_free_text_used: !!(lastImproveTelemetry && lastImproveTelemetry.usedFreeText)
        }
      }
      emitPromptEditFeedback(payload)
      closePopover()
    }
    popoverShadow.getElementById('mw-pop-close').onclick = closePopover

    // "See the difference" CTA — available up to COMPARE_CLIENT_LIMIT times.
    const COMPARE_CLIENT_LIMIT = 5
    const ctaSlot = popoverShadow.getElementById('mw-diff-cta')
    if (ctaSlot && originalDraft) {
      chrome.storage.local.get('mw_compare_count').then((r) => {
        const used = (r && r.mw_compare_count) || 0
        if (used >= COMPARE_CLIENT_LIMIT) return
        const remaining = COMPARE_CLIENT_LIMIT - used
        const label = remaining <= 2
          ? `✨ See the difference this makes → (${remaining} left)`
          : `✨ See the difference this makes →`
        ctaSlot.innerHTML = `<button type="button" class="mw-diff-cta-btn" id="mw-diff-cta-btn">${label}</button>`
        const b = popoverShadow.getElementById('mw-diff-cta-btn')
        if (b) b.onclick = () => runCompareDifference(originalDraft)
      }).catch(() => {})
    }

    popoverState.goal = goal
    popoverState.template = templateName
    improveInFlight = false
    setImproveButtonBusy(false)
    positionPopover()
  }

  async function runCompareDifference(draft) {
    openPopover('loading', loadingBodyHtml('Answering your original draft and the improved prompt with the same AI…'), '')
    try {
      const res = await sendRuntimeMessage({ type: 'COMPARE_ANSWERS', message: draft })
      if (!res || res.error) {
        const isCompareQuota = res && (res.error === 'compare_quota_exceeded' || res.error === 'quota_exceeded')
        const msg = isCompareQuota
          ? 'You have used all your free comparisons. Add your own API key in the extension settings for unlimited use.'
          : (res && res.error ? String(res.error) : 'Could not run the comparison.')
        openPopover('preview', '<p class="err">' + escapeHtml(msg) + '</p>',
          '<button class="btn-ghost" id="mw-pop-close">Close</button>')
        const c = popoverShadow.getElementById('mw-pop-close')
        if (c) c.onclick = closePopover
        return
      }
      renderCompareResult(draft, res)
      // Increment client-side usage counter (server is the authoritative source).
      chrome.storage.local.get('mw_compare_count').then((r) => {
        const used = (r && r.mw_compare_count) || 0
        chrome.storage.local.set({ mw_compare_count: used + 1 }).catch(() => {})
      }).catch(() => {})
      emitPromptEditFeedback({ eventType: 'see_difference', rating: 1 })
    } catch (e) {
      openPopover('preview', '<p class="err">Network error. Try again.</p>',
        '<button class="btn-ghost" id="mw-pop-close">Close</button>')
      const c = popoverShadow.getElementById('mw-pop-close')
      if (c) c.onclick = closePopover
    }
  }

  function renderCompareResult(draft, res) {
    const pop = popoverShadow.getElementById('mw-pop-inner')
    if (pop) pop.classList.add('compare')
    const answerModel = res.answerModelDisplay || ''
    // Only show the evaluation model — the prompt-engineering model is internal.
    const modelNote = answerModel
      ? `<p class="mw-compare-model-note">Both answers below were generated by <strong>${escapeHtml(answerModel)}</strong> — same model, same settings. The prompt is the only thing that changed.</p>`
      : ''
    openPopover('preview', `
      <p class="note">Same AI, two prompts. Left: what you typed. Right: what Mind World wrote.</p>
      ${modelNote}
      <div class="mw-compare-grid">
        <div class="mw-compare-col">
          <div class="mw-compare-head mw-compare-head-raw">Your original prompt</div>
          <div class="mw-compare-prompt">${escapeHtml(draft)}</div>
          <div class="mw-compare-answer-label">Answer${answerModel ? ` · ${escapeHtml(answerModel)}` : ''}</div>
          <div class="mw-compare-answer">${escapeHtml(res.rawAnswer || '')}</div>
        </div>
        <div class="mw-compare-col mw-compare-col-improved">
          <div class="mw-compare-head mw-compare-head-improved">✨ Improved by Mind World</div>
          <div class="mw-compare-prompt">${escapeHtml(res.engineeredPrompt || '')}</div>
          <div class="mw-compare-answer-label">Answer${answerModel ? ` · ${escapeHtml(answerModel)}` : ''}</div>
          <div class="mw-compare-answer">${escapeHtml(res.improvedAnswer || '')}</div>
        </div>
      </div>
    `, `
      <button class="btn-primary" id="mw-compare-done">Got it</button>
    `)
    const title = popoverShadow.getElementById('mw-pop-title')
    if (title) title.textContent = 'See the difference'
    const done = popoverShadow.getElementById('mw-compare-done')
    if (done) done.onclick = closePopover
    positionPopover()
  }

  async function showPersonalizationConfirm(draft, templateName, summaryData) {
    const summary = summaryData.inferredSummary || 'your main topics'
    const corrections = summaryData.quickCorrections || []
    let mode = 'confirm'

    function renderConfirm() {
      chrome.runtime.sendMessage({ type: 'CONFIRM_PERSONALIZATION_SUMMARY', action: 'shown' }).catch(() => {})
      openPopover('confirm', `
        <p class="mw-confirm-summary">Looks like you're using Mind World for <strong>${escapeHtml(summary)}</strong> — sound right?</p>
        <p class="note" style="text-align:left;margin:0;">One tap helps Improve stay personalized without extra typing.</p>
      `, `
        <button class="btn-primary" id="mw-pop-confirm-yes">Yes, that's right</button>
        <button class="btn-ghost" id="mw-pop-confirm-adjust">Adjust</button>
        <button class="btn-ghost" id="mw-pop-confirm-skip">Not now</button>
      `)

      popoverShadow.getElementById('mw-pop-confirm-yes').onclick = async () => {
        await chrome.runtime.sendMessage({ type: 'CONFIRM_PERSONALIZATION_SUMMARY', action: 'confirm' })
        setImproveButtonBusy(true)
        const loadingMsg = await getImproveLoadingMessage()
        openPopover('loading', loadingBodyHtml(loadingMsg), '')
        await continueImproveFlow(draft, templateName)
      }
      popoverShadow.getElementById('mw-pop-confirm-adjust').onclick = () => {
        mode = 'adjust'
        renderAdjust()
      }
      popoverShadow.getElementById('mw-pop-confirm-skip').onclick = async () => {
        await chrome.runtime.sendMessage({ type: 'CONFIRM_PERSONALIZATION_SUMMARY', action: 'skip' })
        setImproveButtonBusy(true)
        const loadingMsg = await getImproveLoadingMessage()
        openPopover('loading', loadingBodyHtml(loadingMsg), '')
        await continueImproveFlow(draft, templateName)
      }
      positionPopover()
    }

    function renderAdjust() {
      const chips = corrections.length ? corrections : [
        { id: 'coding', label: 'Mostly software engineering' },
        { id: 'education', label: 'Mostly school / academics' },
        { id: 'career', label: 'Mostly job search & career' }
      ]
      const selected = new Set()
      openPopover('confirm', `
        <p class="note" style="text-align:left;margin:0;">Tap what fits best (choose one or more):</p>
        <div class="mw-correction-row" id="mw-correction-row">
          ${chips.map(c => `<button type="button" class="q-chip" data-correction="${escapeHtml(c.id)}">${escapeHtml(c.label)}</button>`).join('')}
        </div>
      `, `
        <button class="btn-primary" id="mw-pop-save-correction">Save & continue</button>
        <button class="btn-ghost" id="mw-pop-back-confirm">Back</button>
      `)

      popoverShadow.querySelectorAll('[data-correction]').forEach(btn => {
        btn.onclick = () => {
          const id = btn.dataset.correction
          if (selected.has(id)) {
            selected.delete(id)
            btn.classList.remove('active')
          } else {
            selected.add(id)
            btn.classList.add('active')
          }
        }
      })
      popoverShadow.getElementById('mw-pop-back-confirm').onclick = () => {
        mode = 'confirm'
        renderConfirm()
      }
      popoverShadow.getElementById('mw-pop-save-correction').onclick = async () => {
        const ids = Array.from(selected)
        if (ids.length) {
          await chrome.runtime.sendMessage({
            type: 'CONFIRM_PERSONALIZATION_SUMMARY',
            action: 'correct',
            correctionIds: ids
          })
        } else {
          await chrome.runtime.sendMessage({ type: 'CONFIRM_PERSONALIZATION_SUMMARY', action: 'skip' })
        }
        setImproveButtonBusy(true)
        const loadingMsg = await getImproveLoadingMessage()
        openPopover('loading', loadingBodyHtml(loadingMsg), '')
        await continueImproveFlow(draft, templateName)
      }
      positionPopover()
    }

    if (mode === 'confirm') renderConfirm()
    else renderAdjust()
  }

  async function startImprove(force = false) {
    if (!force && improveInFlight) return
    if (!force && popoverState.mode === 'preview') return

    improveInFlight = true
    setImproveButtonBusy(true)
    const draft = getInputText(anchoredInput)
    if (!draft) {
      improveInFlight = false
      setImproveButtonBusy(false)
      openPopover('preview', '<p class="err">Type something in the chat box first.</p>', `
        <button class="btn-ghost" id="mw-pop-close">OK</button>
      `)
      popoverShadow.getElementById('mw-pop-close').onclick = closePopover
      return
    }

    const loadingMsg = await getImproveLoadingMessage()
    openPopover('loading', loadingBodyHtml(loadingMsg), '')

    const templateName = suggestTemplateName(draft)

    try {
      const stored = await chrome.storage.local.get(['mw_memory_enabled'])
      if (stored.mw_memory_enabled !== false) {
        const summaryRes = await chrome.runtime.sendMessage({ type: 'GET_PERSONALIZATION_SUMMARY' })
        if (!summaryRes.error && summaryRes.shouldShowConfirmation) {
          setImproveButtonBusy(false)
          await showPersonalizationConfirm(draft, templateName, summaryRes)
          return
        }
      }
    } catch (e) { /* continue to engineer */ }

    await continueImproveFlow(draft, templateName)
  }

  async function getFavorites() {
    const stored = await chrome.storage.local.get(FAVORITES_KEY)
    return stored[FAVORITES_KEY] || []
  }

  async function getLocalUsage() {
    const stored = await chrome.storage.local.get(USAGE_KEY)
    return stored[USAGE_KEY] || {}
  }

  function templateUsageScore(t, localUsage) {
    const name = t && t.name
    return (localUsage[name] || 0) * 10 + (t.use_count || 0)
  }

  function sortTemplates(list, sort, favs, localUsage) {
    const out = list.slice()
    if (sort === 'az') {
      out.sort((a, b) => (a.name || '').localeCompare(b.name || ''))
      return out
    }
    out.sort((a, b) => {
      const pinDiff = (favs.includes(b.name) ? 1 : 0) - (favs.includes(a.name) ? 1 : 0)
      if (pinDiff) return pinDiff
      const scoreDiff = templateUsageScore(b, localUsage) - templateUsageScore(a, localUsage)
      if (scoreDiff) return scoreDiff
      return (a.name || '').localeCompare(b.name || '')
    })
    return out
  }

  async function toggleFavorite(name) {
    const favs = await getFavorites()
    const idx = favs.indexOf(name)
    if (idx >= 0) favs.splice(idx, 1)
    else favs.push(name)
    await chrome.storage.local.set({ [FAVORITES_KEY]: favs })
    if (typeof refreshDockChips === 'function') refreshDockChips()
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

  async function weaveAndApplyTemplate(template, chipEl) {
    const draft = getInputText(anchoredInput).trim()
    const tName = template.name || ''
    if (!draft || draft.length < 3) {
      injectTemplate(template)
      return
    }

    const prevLabel = chipEl ? chipEl.textContent : ''
    if (chipEl) {
      chipEl.disabled = true
      chipEl.textContent = 'Weaving…'
      chipEl.style.opacity = '0.7'
      chipEl.style.cursor = 'wait'
    } else {
      openPopover('loading', '<p class="note">Weaving your message with this template...</p>', '')
    }

    try {
      const res = await sendRuntimeMessage({
        type: 'ENGINEER_PROMPT',
        message: draft,
        template: tName || 'none',
        skipMemory: true,
        platform: location.hostname
      })
      if (res.error) {
        const msg = res.error === 'not_logged_in'
          ? 'Sign in via the Mind World extension icon to weave templates.'
          : friendlyEngineerError(res.error)
        openPopover('preview', '<p class="err">' + escapeHtml(msg) + '</p>', `
          <button class="btn-ghost" id="mw-pop-close">Close</button>
        `)
        bindPopoverClose()
        positionPopover()
        return
      }
      const woven = formatEngineeredPrompt(res.engineeredPrompt || '')
      if (woven && typeof injectIntoChat === 'function') injectIntoChat(woven, false)
      if (tName) {
        chrome.runtime.sendMessage({ type: 'TRACK_TEMPLATE_USE', name: tName }).catch(() => {})
      }
      emitPromptEditFeedback({
        eventType: 'template_weave',
        rating: 1,
        templateUsed: tName,
        acceptedUnedited: true,
        edited: false,
        latencyMs: res.latencyMs || 0,
        diffMetrics: { skip_memory: true }
      })
      if (!chipEl) closePopover()
    } catch (e) {
      const msg = friendlyEngineerError(e && e.message)
      openPopover('preview', '<p class="err">' + escapeHtml(msg) + '</p>', `
        <button class="btn-ghost" id="mw-pop-close">Close</button>
      `)
      bindPopoverClose()
      positionPopover()
    } finally {
      if (chipEl) {
        chipEl.disabled = false
        chipEl.textContent = prevLabel
        chipEl.style.opacity = ''
        chipEl.style.cursor = 'pointer'
      }
    }
  }

  function filterTemplatesLocal(list, q, category, tier, favoritesOnly, favs, sort, localUsage) {
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
    return sortTemplates(out, sort || 'popular', favs, localUsage || {})
  }

  async function fetchSuggestedTemplates(draft, limit, category, tier) {
    try {
      const res = await chrome.runtime.sendMessage({
        type: 'SUGGEST_TEMPLATES',
        draft: draft || '',
        limit: limit || 8,
        category: category || '',
        tier: tier || ''
      })
      if (res.templates && res.templates.length) return res.templates
    } catch (e) { /* fallback below */ }
    await loadTemplates(true)
    const list = cachedTemplates.length ? cachedTemplates : FALLBACK_TEMPLATES
    return list.filter(t => !isProTemplate(t)).slice(0, limit || 8)
  }

  function getSuggestionDraft(extraIntent) {
    const chat = getInputText(anchoredInput)
    const intent = (extraIntent || libraryState.intent || '').trim()
    if (chat && intent) return chat + '\n\n' + intent
    return intent || chat
  }

  function isBrowseMode() {
    return !!(libraryState.category || libraryState.tier || libraryState.favoritesOnly)
  }

  async function openLibrary() {
    ensurePopover()
    const pop = popoverShadow.getElementById('mw-pop-inner')
    if (pop) pop.classList.add('library')
    const title = popoverShadow.getElementById('mw-pop-title')
    if (title) title.textContent = 'Templates for you'

    openPopover('library', '<p class="lib-loading">Finding templates that fit what you\'re working on...</p>', `
      <button class="btn-ghost" id="mw-pop-close">Close</button>
    `)
    popoverShadow.getElementById('mw-pop-close').onclick = closePopover

    const catRes = await chrome.runtime.sendMessage({ type: 'GET_TEMPLATE_CATEGORIES' })
    cachedCategories = catRes.categories || []

    let suggestDebounce = null
    let suggestRequestId = 0

    async function renderLibrary() {
      const favs = await getFavorites()
      const localUsage = await getLocalUsage()
      const body = popoverShadow.getElementById('mw-pop-body')
      if (!body) return

      const browsing = isBrowseMode()
      const draft = getSuggestionDraft()

      let pillsHtml = `<button type="button" class="lib-pill${!browsing ? ' active' : ''}" data-for-you="1">For you</button>`
      pillsHtml += `<button type="button" class="lib-pill${libraryState.favoritesOnly ? ' active' : ''}" data-fav="1">Pinned</button>`
      pillsHtml += `<button type="button" class="lib-pill pro-pill${libraryState.tier === 'pro' ? ' active' : ''}" data-tier="pro">Pro</button>`
      cachedCategories.slice(0, 10).forEach(c => {
        const active = libraryState.category === c.category ? ' active' : ''
        pillsHtml += `<button type="button" class="lib-pill${active}" data-cat="${escapeHtml(c.category)}">${escapeHtml(c.category)} (${c.count})</button>`
      })

      const sortHtml = `
        <div class="lib-sort" id="mw-lib-sort">
          <span class="lib-sort-label">Sort:</span>
          <button type="button" class="lib-pill${libraryState.sort === 'popular' ? ' active' : ''}" data-sort="popular">Most used</button>
          <button type="button" class="lib-pill${libraryState.sort === 'az' ? ' active' : ''}" data-sort="az">A–Z</button>
        </div>
      `

      body.innerHTML = `
        <input type="text" class="lib-search" id="mw-lib-intent" placeholder="Describe what you want help with (optional)..." value="${escapeHtml(libraryState.intent)}" />
        <p class="note" style="margin:0;text-align:left;">Mind World picks templates from what you type — no keywords needed.</p>
        <div class="lib-filters" id="mw-lib-filters">${pillsHtml}</div>
        ${sortHtml}
        <div class="lib-list" id="mw-lib-list"><p class="lib-loading">Loading...</p></div>
        <p class="note" id="mw-lib-count"></p>
      `

      const intentInput = popoverShadow.getElementById('mw-lib-intent')
      if (intentInput) {
        intentInput.oninput = () => {
          clearTimeout(suggestDebounce)
          suggestDebounce = setTimeout(async () => {
            libraryState.intent = intentInput.value.trim()
            if (!isBrowseMode()) await loadSuggestions()
          }, 700)
        }
        intentInput.onkeydown = (e) => e.stopPropagation()
      }

      popoverShadow.querySelectorAll('.lib-pill').forEach(btn => {
        btn.onclick = async () => {
          if (btn.dataset.sort) {
            libraryState.sort = btn.dataset.sort
            await renderLibrary()
            return
          }
          if (btn.dataset.forYou) {
            libraryState.category = ''
            libraryState.tier = ''
            libraryState.favoritesOnly = false
          } else if (btn.dataset.fav) {
            libraryState.favoritesOnly = !libraryState.favoritesOnly
            libraryState.category = ''
            libraryState.tier = ''
          } else if (btn.dataset.tier) {
            libraryState.tier = libraryState.tier === 'pro' ? '' : 'pro'
            libraryState.favoritesOnly = false
            libraryState.category = ''
          } else if (btn.dataset.cat !== undefined) {
            libraryState.category = btn.dataset.cat || ''
            libraryState.favoritesOnly = false
            libraryState.tier = ''
          }
          await renderLibrary()
        }
      })

      async function loadSuggestions() {
        const reqId = ++suggestRequestId
        const listEl = popoverShadow.getElementById('mw-lib-list')
        const countEl = popoverShadow.getElementById('mw-lib-count')
        if (!listEl) return

        if (browsing) {
          await loadTemplates(true)
          let filtered = filterTemplatesLocal(
            cachedTemplates.length ? cachedTemplates : FALLBACK_TEMPLATES,
            '',
            libraryState.category,
            libraryState.tier,
            libraryState.favoritesOnly,
            favs,
            libraryState.sort,
            localUsage
          )
          renderList(filtered, listEl, countEl, favs, filtered, localUsage)
          return
        }

        listEl.innerHTML = '<p class="lib-loading">Finding the best templates...</p>'
        const suggestions = await fetchSuggestedTemplates(
          draft,
          12,
          libraryState.category,
          libraryState.tier
        )
        if (reqId !== suggestRequestId) return
        const sortedSuggestions = sortTemplates(suggestions, libraryState.sort, favs, localUsage)
        renderList(sortedSuggestions, listEl, countEl, favs, sortedSuggestions, localUsage)
      }

      function renderList(filtered, listEl, countEl, favs, clickList, localUsage) {
        let listHtml = ''
        if (!filtered.length) {
          listHtml = libraryState.favoritesOnly
            ? '<p class="lib-empty">No pinned templates yet. Click the pin on any template to save it here.</p>'
            : '<p class="lib-empty">No templates yet. Start typing in the chat box and we\'ll suggest some.</p>'
        } else {
          if (!browsing && draft) {
            listHtml += '<div class="lib-section-label">Picked for you</div>'
          } else if (libraryState.favoritesOnly) {
            listHtml += '<div class="lib-section-label">Pinned templates</div>'
          }
          filtered.slice(0, 60).forEach(t => {
            const isPro = (t.tier || '').toLowerCase() === 'pro' || isProTemplate(t)
            const pinned = favs.includes(t.name)
            const reason = t.suggest_reason ? `<div class="lib-item-reason">${escapeHtml(t.suggest_reason)}</div>` : ''
            const uses = localUsage[t.name] || t.use_count || 0
            const useLabel = uses ? ` · ${uses} use${uses !== 1 ? 's' : ''}` : ''
            listHtml += `<div class="lib-item${isPro ? ' pro' : ''}" data-name="${escapeHtml(t.name)}">
              <button type="button" class="lib-star${pinned ? ' on' : ''}" data-star="${escapeHtml(t.name)}" title="${pinned ? 'Unpin' : 'Pin template'}">${pinned ? '\u2605' : '\u2606'}</button>
              <div class="lib-item-body">
                <div class="lib-item-name">${escapeHtml(t.name)}</div>
                <div class="lib-item-desc">${escapeHtml(t.description || '')}</div>
                ${reason}
                <div class="lib-item-meta">${escapeHtml(t.category || '')}${useLabel}</div>
              </div>
            </div>`
          })
        }
        listEl.innerHTML = listHtml
        if (countEl) {
          countEl.textContent = browsing
            ? `${filtered.length} template${filtered.length !== 1 ? 's' : ''}${libraryState.favoritesOnly ? ' pinned' : ''}`
            : `${filtered.length} suggestion${filtered.length !== 1 ? 's' : ''} from your text`
        }

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
            const t = clickList.find(x => x.name === name) || cachedTemplates.find(x => x.name === name)
            if (!t) return
            const attr = t.attribution ? '<p class="note" style="font-size:10px;">' + escapeHtml(t.attribution) + '</p>' : ''
            openPopover('preview', attr + '<textarea id="mw-pop-preview-text" spellcheck="false"></textarea>', `
              <button class="btn-primary" id="mw-pop-use">Use in chat</button>
              <button class="btn-ghost" id="mw-pop-back-lib">Back</button>
            `)
            const ta = popoverShadow.getElementById('mw-pop-preview-text')
            if (ta) {
              ta.value = formatEngineeredPrompt(t.template || '')
              bindPreviewTextarea(ta)
              setTimeout(() => { ta.focus() }, 0)
            }
            popoverShadow.getElementById('mw-pop-use').onclick = async () => {
              const draft = getSuggestionDraft()
              if (draft && draft.length >= 3) {
                closePopover()
                await weaveAndApplyTemplate(t)
              } else {
                injectTemplate(t)
                closePopover()
              }
            }
            popoverShadow.getElementById('mw-pop-back-lib').onclick = openLibrary
            positionPopover()
          }
        })
      }

      await loadSuggestions()
      positionPopover()
    }

    await renderLibrary()
  }

  async function openProLibrary() {
    libraryState.tier = 'pro'
    libraryState.category = ''
    libraryState.favoritesOnly = false
    libraryState.intent = ''
    await openLibrary()
  }

  function escapeHtml(text) {
    const d = document.createElement('div')
    d.textContent = text || ''
    return d.innerHTML
  }

  function buildDockUI(inputField) {
    if (document.getElementById(DOCK_ID)) return

    loadTemplates()

    const dock = document.createElement('div')
    dock.id = DOCK_ID
    dock.style.cssText = `
      display: flex; flex-direction: column; align-items: stretch; gap: 8px;
      padding: 10px;
      background: rgba(17,17,17,0.92);
      border: 1px solid rgba(124,58,237,0.25);
      border-radius: 10px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      z-index: 2147483646;
    `

    const label = document.createElement('span')
    label.textContent = 'Mind World'
    label.style.cssText = 'font-size:11px;color:#a78bfa;font-weight:600;'

    const isKnownPlatform = typeof isMindWorldKnownPlatform === 'function'
      ? isMindWorldKnownPlatform(window.location.hostname)
      : true
    if (!isKnownPlatform) {
      label.title = 'Universal Mode — Improve works here. Auto-save memory only runs on Claude, ChatGPT, Gemini, and Perplexity.'
      label.textContent = 'Mind World \u00b7 Universal'
    }

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
    chipsWrap.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;align-items:center;max-height:220px;overflow:auto;'

    async function renderChips() {
      const existing = chipsWrap.querySelectorAll('.mw-quick-chip')
      existing.forEach(el => el.remove())

      const list = cachedTemplates.length ? cachedTemplates : FALLBACK_TEMPLATES
      const draft = getInputText(anchoredInput)
      const favs = await getFavorites()
      const localUsage = await getLocalUsage()
      let quick = []
      const reqId = ++chipsRequestId

      if (draft.length >= 3) {
        const loading = document.createElement('span')
        loading.className = 'mw-quick-chip'
        loading.textContent = '…'
        loading.style.cssText = `
          padding: 4px 8px; font-size: 11px; border-radius: 12px;
          border: 1px solid rgba(124,58,237,0.2); color: #888;
        `
        chipsWrap.appendChild(loading)

        try {
          const res = await chrome.runtime.sendMessage({
            type: 'SUGGEST_TEMPLATES',
            draft,
            limit: MAX_CHIPS
          })
          if (reqId !== chipsRequestId) return
          loading.remove()
          if (res.templates && res.templates.length) {
            quick = res.templates
          }
        } catch (e) {
          if (reqId === chipsRequestId) loading.remove()
        }
      }

      if (!quick.length) {
        const favTemplates = sortTemplates(
          list.filter(t => favs.includes(t.name) && !isProTemplate(t)),
          'popular',
          favs,
          localUsage
        )
        const standard = sortTemplates(
          list.filter(t => !isProTemplate(t)),
          'popular',
          favs,
          localUsage
        )
        quick = favTemplates.length
          ? favTemplates.slice(0, MAX_CHIPS)
          : standard.slice(0, MAX_CHIPS)
      }

      quick.forEach(t => {
        const chip = document.createElement('button')
        chip.type = 'button'
        chip.className = 'mw-quick-chip'
        const shortName = t.name.replace(/ \(.*\)$/, '').slice(0, 22)
        const pinned = favs.includes(t.name)
        const prefix = draft.length >= 3 ? '✦ ' : (pinned ? '📌 ' : '')
        chip.textContent = prefix + shortName
        const reason = t.suggest_reason ? ' — ' + t.suggest_reason : ''
        chip.title = (t.description || t.name) + reason
        chip.style.cssText = `
          padding: 4px 8px; font-size: 11px; border-radius: 12px; cursor: pointer;
          border: 1px solid rgba(124,58,237,0.35); background: rgba(124,58,237,0.15);
          color: #e9d5ff; white-space: nowrap;
        `
        chip.onmouseover = () => { chip.style.background = 'rgba(124,58,237,0.35)' }
        chip.onmouseout = () => { chip.style.background = 'rgba(124,58,237,0.15)' }
        chip.onclick = () => weaveAndApplyTemplate(t, chip)
        chipsWrap.appendChild(chip)
      })
    }

    refreshDockChips = renderChips
    renderChips()

    function scheduleChipRefresh() {
      clearTimeout(chipsDebounce)
      chipsDebounce = setTimeout(renderChips, 800)
    }

    inputField.addEventListener('input', scheduleChipRefresh)
    inputField.addEventListener('keyup', scheduleChipRefresh)
    inputField.addEventListener('paste', scheduleChipRefresh)

    const improveBtn = document.createElement('button')
    improveBtnEl = improveBtn
    improveBtn.type = 'button'
    improveBtn.textContent = IMPROVE_BTN_LABEL
    improveBtn.title = 'Improve this prompt (Alt+Shift+M)'
    improveBtn.style.cssText = `
      width: 100%; padding: 7px 12px; font-size: 12px; font-weight: 600; border-radius: 6px;
      border: none; background: #7c3aed; color: #fff; cursor: pointer;
    `
    improveBtn.onmouseover = () => { improveBtn.style.background = '#6d28d9' }
    improveBtn.onmouseout = () => { improveBtn.style.background = '#7c3aed' }
    bindDockControl(improveBtn, () => {
      engineerRequestId++
      if (popoverState.mode !== 'closed') closePopover()
      startImprove(true)
    })

    const libraryBtn = document.createElement('button')
    libraryBtn.type = 'button'
    libraryBtn.textContent = 'Templates'
    libraryBtn.title = 'AI-picked templates based on what you type'
    libraryBtn.style.cssText = `
      width: 100%; padding: 6px 10px; font-size: 11px; font-weight: 600; border-radius: 6px; cursor: pointer;
      border: 1px solid rgba(124,58,237,0.4); background: rgba(124,58,237,0.12); color: #c4b5fd;
    `
    bindDockControl(libraryBtn, () => {
      libraryState = { intent: '', category: '', tier: '', favoritesOnly: false, sort: libraryState.sort || 'popular' }
      openLibrary()
    })

    const headerRow = document.createElement('div')
    headerRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px;'
    const titleWrap = document.createElement('div')
    titleWrap.style.cssText = 'display:flex;align-items:center;gap:6px;min-width:0;'

    const collapseBtn = document.createElement('button')
    collapseBtn.type = 'button'
    collapseBtn.title = 'Collapse sidebar'
    collapseBtn.textContent = '−'
    collapseBtn.style.cssText = `
      width: 22px; height: 22px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.18);
      background: rgba(255,255,255,0.04); color: #c4b5fd; cursor: pointer; font-size: 14px;
      line-height: 1;
    `

    titleWrap.appendChild(label)
    titleWrap.appendChild(memoryBadge)
    headerRow.appendChild(titleWrap)
    headerRow.appendChild(collapseBtn)

    dock.appendChild(headerRow)
    dock.appendChild(chipsWrap)
    dock.appendChild(libraryBtn)
    dock.appendChild(improveBtn)

    // Keep dock off the chat input stack so it never steals vertical space.
    dock.dataset.mwDockMode = 'side'
    dock.style.position = 'fixed'
    dock.style.right = '12px'
    dock.style.top = '96px'
    dock.style.width = '320px'
    dock.style.maxWidth = 'min(320px, calc(100vw - 24px))'
    dock.style.maxHeight = 'calc(100vh - 120px)'
    dock.style.overflowY = 'auto'
    dock.style.boxShadow = '0 8px 24px rgba(0,0,0,0.35)'

    const mediaNarrow = window.matchMedia('(max-width: 1180px)')
    let sidebarCollapsed = false
    function applyCollapsedState() {
      if (sidebarCollapsed) {
        dock.style.width = '56px'
        dock.style.padding = '8px'
        dock.style.overflow = 'hidden'
        label.style.display = 'none'
        memoryBadge.style.display = 'none'
        chipsWrap.style.display = 'none'
        libraryBtn.style.display = 'none'
        improveBtn.style.display = 'none'
        collapseBtn.textContent = '+'
        collapseBtn.title = 'Expand sidebar'
      } else {
        dock.style.width = mediaNarrow.matches ? '260px' : '320px'
        dock.style.padding = '10px'
        dock.style.overflowY = 'auto'
        label.style.display = ''
        memoryBadge.style.display = ''
        chipsWrap.style.display = mediaNarrow.matches ? 'none' : 'flex'
        libraryBtn.style.display = ''
        improveBtn.style.display = ''
        collapseBtn.textContent = '−'
        collapseBtn.title = 'Collapse sidebar'
      }
    }

    function applyDockLayout() {
      dock.style.right = mediaNarrow.matches ? '8px' : '12px'
      dock.style.top = mediaNarrow.matches ? '72px' : '96px'
      memoryBadge.style.width = ''
      memoryBadge.style.textAlign = 'left'
      applyCollapsedState()
      positionPopover()
    }
    collapseBtn.onclick = (e) => {
      e.preventDefault()
      e.stopPropagation()
      sidebarCollapsed = !sidebarCollapsed
      applyCollapsedState()
      positionPopover()
    }
    applyDockLayout()
    if (typeof mediaNarrow.addEventListener === 'function') {
      mediaNarrow.addEventListener('change', applyDockLayout)
    } else if (typeof mediaNarrow.addListener === 'function') {
      mediaNarrow.addListener(applyDockLayout)
    }

    document.body.appendChild(dock)
    dockHost = dock
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
      engineerRequestId++
      startImprove(true)
    }
  })

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'TRIGGER_IMPROVE') {
      engineerRequestId++
      startImprove(true)
    }
  })

  document.addEventListener('mousedown', (e) => {
    const host = document.getElementById(POPOVER_ID)
    if (!host || popoverState.mode === 'closed') return
    if (popoverState.mode === 'preview' || popoverState.mode === 'confirm') return
    const path = e.composedPath && e.composedPath()
    if (path && path.includes(host)) return
    if (dockHost && dockHost.contains(e.target)) return
    closePopover()
  })
})()
