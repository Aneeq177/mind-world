const API_BASE = CONFIG.API_BASE
const UPLOAD_BASE = CONFIG.UPLOAD_BASE

document.addEventListener('DOMContentLoaded', async () => {
  const loginView = document.getElementById('login-view')
  const connectedView = document.getElementById('connected-view')
  const emailInput = document.getElementById('email-input')
  const saveBtn = document.getElementById('save-btn')
  const loginError = document.getElementById('login-error')
  const userEmail = document.getElementById('user-email')
  const logoutBtn = document.getElementById('logout-btn')
  const convCount = document.getElementById('conv-count')
  const platformsCount = document.getElementById('platforms-count')
  const openMap = document.getElementById('open-map')
  const uploadBtn = document.getElementById('upload-btn')
  const importFileInput = document.getElementById('import-file-input')
  const importStatus = document.getElementById('import-status')
  const addMoreImportBtn = document.getElementById('add-more-import-btn')
  const instructionsImportBtn = document.getElementById('instructions-import-btn')
  const skipImportBtn = document.getElementById('skip-import-btn')
  const afterSkipHint = document.getElementById('after-skip-hint')
  const profileSection = document.getElementById('profile-section')
  const advancedSection = document.getElementById('advanced-section')
  const statsRow = document.getElementById('stats-row')
  const advancedToggle = document.getElementById('advanced-toggle')
  const advancedContent = document.getElementById('advanced-content')
  const apikeyInputConnected = document.getElementById('apikey-input-connected')
  const saveApikeyBtn = document.getElementById('save-apikey-btn')
  const apikeyStatus = document.getElementById('apikey-status')

  let currentEmail = null

  // Load saved credentials and visibility
  const stored = await chrome.storage.local.get(['mw_email', 'mw_api_key', 'mw_default_visibility'])

  // Apply saved visibility state on open
  applyVisibilityState(stored.mw_default_visibility || 'private')

  if (stored.mw_email) {
    showConnectedView(stored.mw_email, stored.mw_api_key)
    loadStats(stored.mw_email)
  } else {
    loginView.style.display = 'block'
    connectedView.style.display = 'none'
  }

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

  function triggerImportPicker() {
    if (importFileInput) importFileInput.click()
  }

  function setOnboardingMode(isNewUser) {
    if (profileSection) profileSection.classList.toggle('onboarding-collapsed', isNewUser)
    if (advancedSection) advancedSection.classList.toggle('onboarding-collapsed', isNewUser)
    if (statsRow) statsRow.classList.toggle('onboarding-collapsed', isNewUser)
  }

  // Platform picker for export instructions
  document.querySelectorAll('.platform-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const platform = btn.dataset.platform
      document.querySelectorAll('.platform-btn').forEach(b => b.classList.remove('active'))
      btn.classList.add('active')
      const chatgptGuide = document.getElementById('export-guide-chatgpt')
      const claudeGuide = document.getElementById('export-guide-claude')
      if (chatgptGuide) chatgptGuide.style.display = platform === 'chatgpt' ? 'block' : 'none'
      if (claudeGuide) claudeGuide.style.display = platform === 'claude' ? 'block' : 'none'
    })
  })

  if (skipImportBtn) {
    skipImportBtn.addEventListener('click', () => {
      const hero = document.getElementById('onboarding-hero')
      const picker = document.getElementById('platform-picker')
      const chatgptGuide = document.getElementById('export-guide-chatgpt')
      const claudeGuide = document.getElementById('export-guide-claude')
      if (hero) hero.style.display = 'none'
      if (picker) picker.style.display = 'none'
      if (chatgptGuide) chatgptGuide.style.display = 'none'
      if (claudeGuide) claudeGuide.style.display = 'none'
      skipImportBtn.style.display = 'none'
      if (uploadBtn) {
        uploadBtn.textContent = '📁 Import chats later'
        uploadBtn.style.background = 'rgba(124,58,237,0.15)'
        uploadBtn.style.border = '1px solid rgba(124,58,237,0.35)'
      }
      if (afterSkipHint) afterSkipHint.style.display = 'block'
    })
  }

  function showImportStatus(message, isError) {
    if (!importStatus) return
    importStatus.style.display = 'block'
    importStatus.textContent = message
    importStatus.style.color = isError ? '#f87171' : '#6ee7b7'
    importStatus.style.background = isError ? 'rgba(248,113,113,0.1)' : 'rgba(110,231,183,0.1)'
    importStatus.style.border = isError
      ? '1px solid rgba(248,113,113,0.3)'
      : '1px solid rgba(110,231,183,0.3)'
  }

  async function importHistoryFile(file) {
    if (!file || !currentEmail) return

    const name = (file.name || '').toLowerCase()
    const isClaude = name.endsWith('.json')
    const isChatgpt = name.endsWith('.zip')
    if (!isClaude && !isChatgpt) {
      showImportStatus('That file type won\'t work. Use the .zip from ChatGPT or conversations.json from Claude.', true)
      return
    }

    const stored = await chrome.storage.local.get(['mw_api_key'])
    const apiKey = stored.mw_api_key || ''

    if (uploadBtn) {
      uploadBtn.disabled = true
      uploadBtn.textContent = 'Importing...'
    }
    showImportStatus('Uploading your chats... this may take a minute.', false)

    try {
      const form = new FormData()
      form.append('email', currentEmail)
      form.append('api_key', apiKey)
      if (isClaude) form.append('claude_file', file, file.name)
      else form.append('chatgpt_file', file, file.name)

      const res = await fetch(`${API_BASE}/process`, { method: 'POST', body: form })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        const detail = err.detail
        const msg = typeof detail === 'string' ? detail : (Array.isArray(detail) ? detail[0]?.msg : null) || 'Import failed'
        throw new Error(msg)
      }

      const data = await res.json()
      const total = data.total || 0
      showImportStatus(`Done! ${total} conversations imported. Mind World will remember them for you.`, false)
      loadStats(currentEmail)
    } catch (err) {
      const msg = String(err.message || err)
      if (msg.includes('API key')) {
        showImportStatus('Import needs an API key. Open API Settings above, add your free key, then try again.', true)
        if (advancedSection) advancedSection.classList.remove('onboarding-collapsed')
        if (advancedContent) advancedContent.style.display = 'block'
        if (advancedToggle) advancedToggle.classList.add('advanced-open')
      } else if (msg.includes('No conversations')) {
        showImportStatus('No conversations found in that file. Make sure you downloaded the full export.', true)
      } else {
        showImportStatus(msg, true)
      }
    } finally {
      if (uploadBtn) {
        uploadBtn.disabled = false
        uploadBtn.textContent = '📁 I downloaded it — upload here'
      }
      if (importFileInput) importFileInput.value = ''
    }
  }

  // Import history from popup (no redirect to web app)
  uploadBtn.addEventListener('click', () => {
    const picker = document.getElementById('platform-picker')
    if (picker && picker.style.display === 'none') {
      picker.style.display = 'flex'
      const active = document.querySelector('.platform-btn.active')
      const platform = active?.dataset.platform || 'chatgpt'
      const chatgptGuide = document.getElementById('export-guide-chatgpt')
      const claudeGuide = document.getElementById('export-guide-claude')
      if (chatgptGuide) chatgptGuide.style.display = platform === 'chatgpt' ? 'block' : 'none'
      if (claudeGuide) claudeGuide.style.display = platform === 'claude' ? 'block' : 'none'
      uploadBtn.textContent = '📁 I downloaded it — upload here'
      uploadBtn.style.background = ''
      uploadBtn.style.border = ''
      return
    }
    triggerImportPicker()
  })
  if (addMoreImportBtn) addMoreImportBtn.addEventListener('click', () => triggerImportPicker())
  if (instructionsImportBtn) instructionsImportBtn.addEventListener('click', () => triggerImportPicker())

  if (importFileInput) {
    importFileInput.addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0]
      if (file) importHistoryFile(file)
    })
  }

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

      showConnectedView(email, null)
      loadStats(email)

    } catch (err) {
      loginError.textContent = 'Connection failed. Check your internet.'
      saveBtn.disabled = false
      saveBtn.textContent = 'Connect to Mind World'
    }
  })

  // Personal Profile Toggle + onboarding fields
  const profileOptIn = document.getElementById('profile-opt-in')
  const profileStatus = document.getElementById('profile-status')
  const profileFields = document.getElementById('profile-fields')
  const saveProfileBtn = document.getElementById('save-profile-btn')
  const profileInputs = {
    background: document.getElementById('profile-background'),
    situation: document.getElementById('profile-situation'),
    goals: document.getElementById('profile-goals'),
    constraints: document.getElementById('profile-constraints'),
    preferences: document.getElementById('profile-preferences')
  }

  function showProfileFields(show) {
    if (profileFields) profileFields.style.display = show ? 'flex' : 'none'
  }

  function getProfileDataFromForm() {
    return {
      background: profileInputs.background?.value.trim() || '',
      situation: profileInputs.situation?.value.trim() || '',
      goals: profileInputs.goals?.value.trim() || '',
      constraints: profileInputs.constraints?.value.trim() || '',
      preferences: profileInputs.preferences?.value.trim() || ''
    }
  }

  function fillProfileForm(data) {
    if (!data) return
    Object.keys(profileInputs).forEach(key => {
      if (profileInputs[key]) profileInputs[key].value = data[key] || ''
    })
  }

  async function loadProfileSettings(email) {
    if (!email) return
    try {
      const res = await fetch(`${API_BASE}/get_profile_settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      })
      if (!res.ok) return
      const data = await res.json()
      const enabled = !!data.is_profile_enabled
      if (profileOptIn) profileOptIn.checked = enabled
      await chrome.storage.local.set({ mw_profile_enabled: enabled })
      fillProfileForm(data.profile_data)
      showProfileFields(enabled)
    } catch (err) {
      // use local storage fallback
      const local = await chrome.storage.local.get(['mw_profile_enabled'])
      if (profileOptIn) profileOptIn.checked = !!local.mw_profile_enabled
      showProfileFields(!!local.mw_profile_enabled)
    }
  }

  async function saveProfileSettings(isEnabled, profileData) {
    if (!currentEmail) return false
    try {
      await fetch(`${API_BASE}/update_profile_settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: currentEmail,
          is_profile_enabled: isEnabled,
          profile_data: profileData
        })
      })
      return true
    } catch (err) {
      return false
    }
  }

  if (profileOptIn) {
    profileOptIn.addEventListener('change', async (e) => {
      const isEnabled = e.target.checked
      await chrome.storage.local.set({ mw_profile_enabled: isEnabled })
      showProfileFields(isEnabled)

      if (!currentEmail) return

      const ok = await saveProfileSettings(isEnabled, getProfileDataFromForm())
      if (ok && profileStatus) {
        profileStatus.textContent = isEnabled ? 'Profile enabled for prompt enrichment' : 'Profile disabled'
        profileStatus.style.display = 'block'
        setTimeout(() => { profileStatus.style.display = 'none' }, 3000)
      }
    })
  }

  if (saveProfileBtn) {
    saveProfileBtn.addEventListener('click', async () => {
      if (!currentEmail) return
      saveProfileBtn.disabled = true
      saveProfileBtn.textContent = 'Saving...'

      const profileData = getProfileDataFromForm()
      const isEnabled = profileOptIn ? profileOptIn.checked : false
      const ok = await saveProfileSettings(isEnabled, profileData)

      saveProfileBtn.disabled = false
      saveProfileBtn.textContent = 'Save Profile'
      if (ok && profileStatus) {
        profileStatus.textContent = 'Profile saved'
        profileStatus.style.display = 'block'
        setTimeout(() => { profileStatus.style.display = 'none' }, 3000)
      }
    })
  }

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
    connectedView.style.display = 'none'
    loginView.style.display = 'block'
    emailInput.value = ''
  })

  function showConnectedView(email, existingApiKey) {
    currentEmail = email
    loginView.style.display = 'none'
    connectedView.style.display = 'block'
    userEmail.textContent = email
    loadProfileSettings(email)

    if (existingApiKey && apikeyStatus) {
      apikeyStatus.textContent = 'API key configured'
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
        const uploadUrl = `${UPLOAD_BASE}?email=${encodeURIComponent(email)}`

        if (count === 0) {
          if (onboarding) onboarding.style.display = 'block'
          if (addMoreBanner) addMoreBanner.style.display = 'none'
          if (instructions) instructions.style.display = 'none'
          if (openMap) openMap.style.display = 'none'
          setOnboardingMode(true)
        } else if (count < 50) {
          if (onboarding) onboarding.style.display = 'none'
          if (addMoreBanner) addMoreBanner.style.display = 'flex'
          if (instructions) instructions.style.display = 'block'
          if (openMap) openMap.style.display = 'block'
          setOnboardingMode(false)
        } else {
          if (onboarding) onboarding.style.display = 'none'
          if (addMoreBanner) addMoreBanner.style.display = 'none'
          if (instructions) instructions.style.display = 'block'
          if (openMap) openMap.style.display = 'block'
          setOnboardingMode(false)
        }
      }
    } catch {
      convCount.textContent = '—'
      platformsCount.textContent = '—'
    }
  }
})
