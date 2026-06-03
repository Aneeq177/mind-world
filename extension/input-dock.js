// Mind World — input-adjacent UI (template chips + Improve popover)
// Loaded after content.js; uses findInputField() and injectIntoChat() from content.js

(function () {
  const DOCK_ID = 'mw-input-dock'
  const POPOVER_ID = 'mw-improve-popover-host'
  const MAX_CHIPS = 6

  let cachedTemplates = []
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

  async function loadTemplates() {
    try {
      const res = await chrome.runtime.sendMessage({ type: 'GET_TEMPLATES' })
      cachedTemplates = (res.templates && res.templates.length) ? res.templates : FALLBACK_TEMPLATES
    } catch (e) {
      cachedTemplates = FALLBACK_TEMPLATES
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
      { kw: ['interview', 'resume', 'job'], name: 'Interview Prep' },
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
        width: 360px;
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
        width: 100%; min-height: 120px; max-height: 200px;
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
    if (pop) pop.classList.remove('open')
    popoverState.mode = 'closed'
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
    else title.textContent = 'Review improved prompt'

    body.innerHTML = html
    actions.innerHTML = actionsHtml
    pop.classList.add('open')
    positionPopover()
    popoverState.mode = mode
  }

  async function runEngineer(message, templateName) {
    openPopover('loading', '<p class="note">Using your draft and past context...</p>', '')
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
      showPreviewResult(res.engineeredPrompt, res.conversationsUsed || 0, message, templateName)
    } catch (e) {
      openPopover('preview', '<p class="err">Network error. Try again.</p>', `
        <button class="btn-ghost" id="mw-pop-close">Close</button>
      `)
      popoverShadow.getElementById('mw-pop-close').onclick = closePopover
    }
  }

  function showPreviewResult(text, conversationsUsed, goal, templateName) {
    const note = conversationsUsed > 0
      ? 'Enriched with ' + conversationsUsed + ' past conversation' + (conversationsUsed > 1 ? 's' : '')
      : 'Engineered from your draft'
    openPopover('preview', `
      <p class="note">${note}</p>
      <textarea id="mw-pop-preview-text" spellcheck="false"></textarea>
    `, `
      <button class="btn-primary" id="mw-pop-replace">Replace in chat</button>
      <button class="btn-ghost" id="mw-pop-close">Cancel</button>
    `)
    const ta = popoverShadow.getElementById('mw-pop-preview-text')
    if (ta) ta.value = text
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

  function injectTemplate(template) {
    const body = template.template || template
    const text = typeof body === 'string' ? body : ''
    if (typeof injectIntoChat === 'function') injectIntoChat(text, false)
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

    const chipsWrap = document.createElement('div')
    chipsWrap.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;flex:1;'

    function renderChips() {
      chipsWrap.innerHTML = ''
      const list = cachedTemplates.length ? cachedTemplates : FALLBACK_TEMPLATES
      list.slice(0, MAX_CHIPS).forEach(t => {
        const chip = document.createElement('button')
        chip.type = 'button'
        chip.textContent = t.name
        chip.title = t.description || t.name
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

      if (list.length > MAX_CHIPS) {
        const more = document.createElement('select')
        more.style.cssText = 'font-size:11px;padding:3px 6px;border-radius:6px;background:#222;color:#fff;border:1px solid #444;'
        const opt0 = document.createElement('option')
        opt0.value = ''
        opt0.textContent = 'More...'
        more.appendChild(opt0)
        list.slice(MAX_CHIPS).forEach(t => {
          const o = document.createElement('option')
          o.value = t.name
          o.textContent = t.name
          more.appendChild(o)
        })
        more.onchange = () => {
          const t = list.find(x => x.name === more.value)
          if (t) injectTemplate(t)
          more.value = ''
        }
        chipsWrap.appendChild(more)
      }
    }

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

    dock.appendChild(label)
    dock.appendChild(chipsWrap)
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
