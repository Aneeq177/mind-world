const API_BASE = 'https://mind-world-app-mv4yv.ondigitalocean.app'
const UPLOAD_BASE = 'https://mind-world.app'

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
  const advancedToggle = document.getElementById('advanced-toggle')
  const advancedContent = document.getElementById('advanced-content')
  const apikeyInputConnected = document.getElementById('apikey-input-connected')
  const saveApikeyBtn = document.getElementById('save-apikey-btn')
  const apikeyStatus = document.getElementById('apikey-status')

  let currentEmail = null

  // Check if already logged in (email only required now)
  const stored = await chrome.storage.local.get(['mw_email', 'mw_api_key'])

  if (stored.mw_email) {
    showConnectedView(stored.mw_email, stored.mw_api_key)
    loadStats(stored.mw_email)
  } else {
    loginView.style.display = 'block'
    connectedView.style.display = 'none'
  }

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

      showConnectedView(email, null)
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
    connectedView.style.display = 'none'
    loginView.style.display = 'block'
    emailInput.value = ''
  })

  function showConnectedView(email, existingApiKey) {
    currentEmail = email
    loginView.style.display = 'none'
    connectedView.style.display = 'block'
    userEmail.textContent = email

    // Show API key status if already configured
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
          // Full onboarding: no conversations yet
          if (onboarding) onboarding.style.display = 'block'
          if (addMoreBanner) addMoreBanner.style.display = 'none'
          if (instructions) instructions.style.display = 'none'
          if (openMap) openMap.style.display = 'none'
        } else if (count < 50) {
          // Some conversations, but nudge to add more
          if (onboarding) onboarding.style.display = 'none'
          if (addMoreBanner) addMoreBanner.style.display = 'flex'
          if (instructions) instructions.style.display = 'block'
          if (openMap) openMap.style.display = 'block'
        } else {
          // Enough conversations — clean view, no prompts
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
  }
})
