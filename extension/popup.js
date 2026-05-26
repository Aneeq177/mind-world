const API_BASE = 'https://mind-world-app-mv4yv.ondigitalocean.app'
const UPLOAD_BASE = 'https://mind-world.app'

document.addEventListener('DOMContentLoaded', async () => {
  const loginView = document.getElementById('login-view')
  const connectedView = document.getElementById('connected-view')
  const emailInput = document.getElementById('email-input')
  const apikeyInput = document.getElementById('apikey-input')
  const saveBtn = document.getElementById('save-btn')
  const loginError = document.getElementById('login-error')
  const userEmail = document.getElementById('user-email')
  const logoutBtn = document.getElementById('logout-btn')
  const convCount = document.getElementById('conv-count')
  const platformsCount = document.getElementById('platforms-count')
  const openMap = document.getElementById('open-map')
  const uploadBtn = document.getElementById('upload-btn')

  let currentEmail = null

  // Check if already logged in
  const stored = await chrome.storage.local.get(['mw_email', 'mw_api_key'])

  if (stored.mw_email && stored.mw_api_key) {
    showConnectedView(stored.mw_email)
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

  // Save credentials
  saveBtn.addEventListener('click', async () => {
    const email = emailInput.value.trim()
    const apiKey = apikeyInput.value.trim()

    loginError.textContent = ''

    if (!email || !email.includes('@')) {
      loginError.textContent = 'Please enter a valid email.'
      return
    }

    if (!apiKey || !apiKey.startsWith('sk-ant-')) {
      loginError.textContent = 'API key must start with sk-ant-'
      return
    }

    saveBtn.disabled = true
    saveBtn.textContent = 'Connecting...'

    try {
      const res = await fetch(`${API_BASE}/health`)
      if (!res.ok) throw new Error('Cannot reach Mind World server')

      await chrome.storage.local.set({ mw_email: email, mw_api_key: apiKey })

      const tabs = await chrome.tabs.query({})
      tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, {
          type: 'CREDENTIALS_UPDATED',
          email,
          apiKey
        }).catch(() => {})
      })

      showConnectedView(email)
      loadStats(email)

    } catch (err) {
      loginError.textContent = 'Connection failed. Check your internet.'
      saveBtn.disabled = false
      saveBtn.textContent = 'Activate Mind World'
    }
  })

  // Logout
  logoutBtn.addEventListener('click', async () => {
    await chrome.storage.local.remove(['mw_email', 'mw_api_key'])
    currentEmail = null
    connectedView.style.display = 'none'
    loginView.style.display = 'block'
    emailInput.value = ''
    apikeyInput.value = ''
  })

  function showConnectedView(email) {
    currentEmail = email
    loginView.style.display = 'none'
    connectedView.style.display = 'block'
    userEmail.textContent = email

    // Pre-fill the open-map link with the email so the upload page knows who this is
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

        if (count === 0) {
          if (onboarding) onboarding.style.display = 'block'
          if (instructions) instructions.style.display = 'none'
          if (openMap) openMap.style.display = 'none'
        } else {
          if (onboarding) onboarding.style.display = 'none'
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
