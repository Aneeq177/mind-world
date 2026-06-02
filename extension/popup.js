const API_BASE = CONFIG.API_BASE
const UPLOAD_BASE = CONFIG.UPLOAD_BASE

document.addEventListener('DOMContentLoaded', async () => {
  const loginView = document.getElementById('login-view')
  const settingsView = document.getElementById('settings-view') // formerly connected-view
  const promptBuilderView = document.getElementById('prompt-builder-view')
  const emailInput = document.getElementById('email-input')
  const saveBtn = document.getElementById('save-btn')
  const loginError = document.getElementById('login-error')
  const userEmail = document.getElementById('user-email')
  const logoutBtn = document.getElementById('logout-btn')
  const convCount = document.getElementById('conv-count')
  const platformsCount = document.getElementById('platforms-count')
  const openMap = document.getElementById('open-map')
  const uploadBtn = document.getElementById('upload-btn')
  const advancedToggle = document.getElementById('advanced-toggle')
  const advancedContent = document.getElementById('advanced-content')
  const apikeyInputConnected = document.getElementById('apikey-input-connected')
  const saveApikeyBtn = document.getElementById('save-apikey-btn')
  const apikeyStatus = document.getElementById('apikey-status')

  // Prompt Builder elements
  const openSettingsBtn = document.getElementById('open-settings-btn')
  const backToBuilderBtn = document.getElementById('back-to-builder-btn')
  const startBuilderBtn = document.getElementById('start-builder-btn')
  const resetBuilderBtn = document.getElementById('reset-builder-btn')
  const builderInputMode = document.getElementById('builder-input-mode')
  const builderChatMode = document.getElementById('builder-chat-mode')
  const goalInput = document.getElementById('goal-input')
  const templateSelect = document.getElementById('template-select')
  const useProfileContext = document.getElementById('use-profile-context')
  const chatMessages = document.getElementById('chat-messages')
  const chatReplyInput = document.getElementById('chat-reply-input')
  const chatSendBtn = document.getElementById('chat-send-btn')

  let currentEmail = null

  // Load saved credentials and visibility
  const stored = await chrome.storage.local.get(['mw_email', 'mw_api_key', 'mw_default_visibility', 'mw_use_profile_context'])
  useProfileContext.checked = stored.mw_use_profile_context === true

  // Apply saved visibility state on open
  applyVisibilityState(stored.mw_default_visibility || 'private')

  if (stored.mw_email) {
    showPromptBuilderView(stored.mw_email, stored.mw_api_key)
    loadStats(stored.mw_email)
  } else {
    loginView.style.display = 'block'
    promptBuilderView.style.display = 'none'
    settingsView.style.display = 'none'
  }

  useProfileContext.addEventListener('change', (e) => {
    chrome.storage.local.set({ mw_use_profile_context: e.target.checked })
  })

  openSettingsBtn.addEventListener('click', () => {
    promptBuilderView.style.display = 'none'
    settingsView.style.display = 'block'
  })

  backToBuilderBtn.addEventListener('click', () => {
    settingsView.style.display = 'none'
    promptBuilderView.style.display = 'block'
  })

  function appendChatMessage(role, text) {
    const bubble = document.createElement('div')
    bubble.className = `chat-bubble ${role}`
    bubble.textContent = text
    chatMessages.appendChild(bubble)
    chatMessages.scrollTop = chatMessages.scrollHeight
  }

  startBuilderBtn.addEventListener('click', () => {
    const goal = goalInput.value.trim()
    if (!goal) return
    
    // Switch to chat mode
    builderInputMode.style.display = 'none'
    builderChatMode.style.display = 'flex'
    chatMessages.innerHTML = '' // Clear
    
    // Resize popup for chat
    document.body.style.height = '550px'
    
    appendChatMessage('user', goal)
    appendChatMessage('system', 'Initializing Prompt Engineer...')

    // Mock AI Clarifying Questions
    setTimeout(() => {
      appendChatMessage('ai', 'I have 2 clarifying questions before I generate your prompt:\n1. Who is the target audience?\n2. What tone should it be? (e.g. professional, casual)')
    }, 1500)
  })

  chatSendBtn.addEventListener('click', () => {
    const reply = chatReplyInput.value.trim()
    if (!reply) return
    appendChatMessage('user', reply)
    chatReplyInput.value = ''
    
    setTimeout(() => {
      appendChatMessage('system', 'Generating final prompt...')
    }, 500)

    setTimeout(() => {
      appendChatMessage('ai', 'Here is your engineered prompt:\n\n"Act as an expert... [Mock Final Prompt Generated]"')
    }, 2500)
  })

  resetBuilderBtn.addEventListener('click', () => {
    builderChatMode.style.display = 'none'
    builderInputMode.style.display = 'block'
    goalInput.value = ''
    document.body.style.height = 'auto'
  })

  // Visibility toggle (inside has-workspace panel)
  document.getElementById('vis-private').addEventListener('click', async () => {
    await chrome.storage.local.set({ mw_default_visibility: 'private' })
    applyVisibilityState('private')
  })

  document.getElementById('vis-team').addEventListener('click', async () => {
    await chrome.storage.local.set({ mw_default_visibility: 'team' })
    applyVisibilityState('team')
  })

  function applyVisibilityState(visibility) {
    const privateBtn = document.getElementById('vis-private')
    const teamBtn = document.getElementById('vis-team')
    if (!privateBtn || !teamBtn) return
    if (visibility === 'team') {
      teamBtn.style.background = 'rgba(124,58,237,0.3)'
      teamBtn.style.border = '1px solid rgba(124,58,237,0.5)'
      teamBtn.style.color = 'white'
      privateBtn.style.background = 'transparent'
      privateBtn.style.border = '1px solid rgba(255,255,255,0.1)'
      privateBtn.style.color = '#888'
    } else {
      privateBtn.style.background = 'rgba(124,58,237,0.3)'
      privateBtn.style.border = '1px solid rgba(124,58,237,0.5)'
      privateBtn.style.color = 'white'
      teamBtn.style.background = 'transparent'
      teamBtn.style.border = '1px solid rgba(255,255,255,0.1)'
      teamBtn.style.color = '#888'
    }
  }

  // Workspace UI helpers
  function showWorkspaceState(state) {
    document.getElementById('no-workspace').style.display = state === 'none' ? 'block' : 'none'
    document.getElementById('create-workspace-form').style.display = state === 'create' ? 'block' : 'none'
    document.getElementById('join-workspace-form').style.display = state === 'join' ? 'block' : 'none'
    document.getElementById('has-workspace').style.display = state === 'has' ? 'block' : 'none'
  }

  function populateWorkspace(ws) {
    document.getElementById('workspace-name-display').textContent = ws.name
    document.getElementById('workspace-members-display').textContent = `${ws.member_count} member${ws.member_count !== 1 ? 's' : ''}`
    document.getElementById('workspace-code-display').textContent = ws.invite_code
    chrome.storage.local.set({
      mw_has_workspace: true,
      mw_workspace_name: ws.name,
      mw_workspace_code: ws.invite_code
    })
  }

  // Workspace button handlers
  document.getElementById('btn-create-workspace').addEventListener('click', () => {
    showWorkspaceState('create')
  })

  document.getElementById('btn-create-cancel').addEventListener('click', () => {
    showWorkspaceState('none')
  })

  document.getElementById('btn-join-workspace').addEventListener('click', () => {
    showWorkspaceState('join')
  })

  document.getElementById('btn-join-cancel').addEventListener('click', () => {
    showWorkspaceState('none')
  })

  document.getElementById('btn-create-confirm').addEventListener('click', async () => {
    const name = document.getElementById('workspace-name-input').value.trim()
    const errEl = document.getElementById('create-error')
    errEl.style.display = 'none'
    if (!name) { errEl.textContent = 'Please enter a workspace name.'; errEl.style.display = 'block'; return }

    const btn = document.getElementById('btn-create-confirm')
    btn.disabled = true
    btn.textContent = 'Creating...'

    try {
      const res = await fetch(`${API_BASE}/create_workspace`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: currentEmail, workspace_name: name })
      })
      const data = await res.json()
      if (data.success) {
        populateWorkspace({ name: data.workspace_name, invite_code: data.invite_code, member_count: 1 })
        showWorkspaceState('has')
        applyVisibilityState(stored.mw_default_visibility || 'private')
        await chrome.storage.local.set({ mw_has_company: true })
      } else {
        errEl.textContent = data.reason || 'Failed to create workspace.'
        errEl.style.display = 'block'
      }
    } catch (e) {
      errEl.textContent = 'Network error. Try again.'
      errEl.style.display = 'block'
    }

    btn.disabled = false
    btn.textContent = 'Create'
  })

  document.getElementById('btn-join-confirm').addEventListener('click', async () => {
    const code = document.getElementById('invite-code-input').value.trim()
    const errEl = document.getElementById('join-error')
    errEl.style.display = 'none'
    if (!code) { errEl.textContent = 'Please enter an invite code.'; errEl.style.display = 'block'; return }

    const btn = document.getElementById('btn-join-confirm')
    btn.disabled = true
    btn.textContent = 'Joining...'

    try {
      const res = await fetch(`${API_BASE}/join_workspace`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: currentEmail, invite_code: code })
      })
      const data = await res.json()
      if (data.success) {
        populateWorkspace({ name: data.workspace_name, invite_code: code.toUpperCase(), member_count: data.member_count })
        showWorkspaceState('has')
        applyVisibilityState(stored.mw_default_visibility || 'private')
        await chrome.storage.local.set({ mw_has_company: true })
      } else {
        errEl.textContent = data.reason || 'Failed to join workspace.'
        errEl.style.display = 'block'
      }
    } catch (e) {
      errEl.textContent = 'Network error. Try again.'
      errEl.style.display = 'block'
    }

    btn.disabled = false
    btn.textContent = 'Join'
  })

  document.getElementById('btn-copy-code').addEventListener('click', () => {
    const code = document.getElementById('workspace-code-display').textContent
    navigator.clipboard.writeText(code).catch(() => {})
    const btn = document.getElementById('btn-copy-code')
    btn.textContent = 'Copied!'
    setTimeout(() => { btn.textContent = 'Copy' }, 2000)
  })

  document.getElementById('btn-leave-workspace').addEventListener('click', async () => {
    const name = document.getElementById('workspace-name-display').textContent
    if (!confirm(`Leave workspace "${name}"? You will lose access to team conversations.`)) return

    try {
      await fetch(`${API_BASE}/leave_workspace`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: currentEmail })
      })
    } catch (e) {}

    await chrome.storage.local.set({ mw_has_workspace: false, mw_has_company: false, mw_workspace_name: '', mw_workspace_code: '' })
    showWorkspaceState('none')
  })

  document.getElementById('btn-share-all')?.addEventListener('click', async () => {
    const confirmed = confirm(
      'Share all your conversations with your team? ' +
      'They will be searchable by workspace members.'
    )
    if (!confirmed) return

    try {
      const response = await fetch(`${API_BASE}/share_conversations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: currentEmail, visibility: 'team' })
      })
      const data = await response.json()
      const status = document.getElementById('share-status')
      if (data.success) {
        status.textContent = '✓ Conversations shared with team'
        status.style.display = 'block'
        setTimeout(() => { status.style.display = 'none' }, 3000)
      }
    } catch (err) {
      // do nothing
    }
  })

  // Upload button opens the app with email pre-filled
  uploadBtn.addEventListener('click', () => {
    if (currentEmail) {
      const url = `${UPLOAD_BASE}?email=${encodeURIComponent(currentEmail)}`
      chrome.tabs.create({ url })
    }
  })

  // Save email (login)
  saveBtn.addEventListener('click', async () => {
    const email = emailInput.value.trim()
    loginError.textContent = ''

    if (!email || !email.includes('@')) {
      loginError.textContent = 'Please enter a valid email.'
      return
    }

    saveBtn.disabled = true
    saveBtn.textContent = 'Connecting...'

    try {
      const res = await fetch(`${API_BASE}/health`)
      if (!res.ok) throw new Error('Cannot reach Mind World server')

      await chrome.storage.local.set({ mw_email: email })

      const tabs = await chrome.tabs.query({})
      tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, { type: 'CREDENTIALS_UPDATED', email }).catch(() => {})
      })

      showPromptBuilderView(email, apiKey)
      loadStats(email)

    } catch (err) {
      loginError.textContent = 'Connection failed. Check your internet.'
      saveBtn.disabled = false
      saveBtn.textContent = 'Connect to Mind World'
    }
  })

  // Advanced section toggle
  advancedToggle.addEventListener('click', () => {
    const isOpen = advancedContent.style.display !== 'none'
    advancedContent.style.display = isOpen ? 'none' : 'block'
    advancedToggle.classList.toggle('advanced-open', !isOpen)
  })

  // Save API key separately
  saveApikeyBtn.addEventListener('click', async () => {
    const apiKey = apikeyInputConnected.value.trim()
    if (!apiKey || !apiKey.startsWith('sk-ant-')) {
      apikeyStatus.textContent = 'API key must start with sk-ant-'
      apikeyStatus.className = 'apikey-error'
      return
    }
    await chrome.storage.local.set({ mw_api_key: apiKey })
    apikeyStatus.textContent = '✓ API key saved'
    apikeyStatus.className = 'apikey-saved'
    apikeyInputConnected.value = ''
  })

  // Logout
  logoutBtn.addEventListener('click', async () => {
    await chrome.storage.local.remove(['mw_email', 'mw_api_key'])
    currentEmail = null
    settingsView.style.display = 'none'
    promptBuilderView.style.display = 'none'
    loginView.style.display = 'block'
    emailInput.value = ''
  })

  function showPromptBuilderView(email, existingApiKey) {
    currentEmail = email
    loginView.style.display = 'none'
    settingsView.style.display = 'none'
    promptBuilderView.style.display = 'block'
    userEmail.textContent = email

    if (existingApiKey && apikeyStatus) {
      apikeyStatus.textContent = '✓ API key configured'
      apikeyStatus.className = 'apikey-saved'
    }

    const uploadUrl = `${UPLOAD_BASE}?email=${encodeURIComponent(email)}`
    if (openMap) openMap.href = uploadUrl
  }

  async function loadStats(email) {
    try {
      const res = await fetch(`${API_BASE}/user_stats`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      })
      if (res.ok) {
        const data = await res.json()
        const count = data.conversation_count || 0
        convCount.textContent = count
        platformsCount.textContent = data.platform_count || '0'

        const onboarding = document.getElementById('onboarding')
        const instructions = document.getElementById('instructions')
        const addMoreBanner = document.getElementById('add-more-banner')
        const addMoreLink = document.getElementById('add-more-link')
        const uploadUrl = `${UPLOAD_BASE}?email=${encodeURIComponent(email)}`

        if (addMoreLink) addMoreLink.href = uploadUrl

        if (count === 0) {
          if (onboarding) onboarding.style.display = 'block'
          if (addMoreBanner) addMoreBanner.style.display = 'none'
          if (instructions) instructions.style.display = 'none'
          if (openMap) openMap.style.display = 'none'
        } else if (count < 50) {
          if (onboarding) onboarding.style.display = 'none'
          if (addMoreBanner) addMoreBanner.style.display = 'flex'
          if (instructions) instructions.style.display = 'block'
          if (openMap) openMap.style.display = 'block'
        } else {
          if (onboarding) onboarding.style.display = 'none'
          if (addMoreBanner) addMoreBanner.style.display = 'none'
          if (instructions) instructions.style.display = 'block'
          if (openMap) openMap.style.display = 'block'
        }
      }
    } catch {
      convCount.textContent = '—'
      platformsCount.textContent = '—'
    }

    // Load workspace info separately
    loadWorkspaceInfo(email)
  }

  async function loadWorkspaceInfo(email) {
    try {
      const res = await fetch(`${API_BASE}/workspace_info`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      })
      if (!res.ok) { showWorkspaceState('none'); return }
      const data = await res.json()

      if (data.workspace) {
        populateWorkspace(data.workspace)
        showWorkspaceState('has')
        applyVisibilityState(
          (await chrome.storage.local.get('mw_default_visibility')).mw_default_visibility || 'private'
        )
        await chrome.storage.local.set({ mw_has_company: true })
      } else {
        await chrome.storage.local.set({ mw_has_workspace: false, mw_has_company: false })
        showWorkspaceState('none')
      }
    } catch {
      showWorkspaceState('none')
    }
  }
})
