/* Shared Mind World chrome.storage.local helpers (popup, background, content). */

const MW_STORAGE_PREFIX = 'mw_'

const MW_HOST_PATTERNS = [
  'https://claude.ai/*',
  'https://chatgpt.com/*',
  'https://gemini.google.com/*',
  'https://perplexity.ai/*'
]

async function getMindWorldStorageKeys() {
  const all = await chrome.storage.local.get(null)
  return Object.keys(all).filter((k) => k.startsWith(MW_STORAGE_PREFIX))
}

async function clearAllMindWorldStorage() {
  let keys = await getMindWorldStorageKeys()
  if (keys.length) await chrome.storage.local.remove(keys)

  // Second pass — content scripts may race and rewrite keys during the first remove.
  keys = await getMindWorldStorageKeys()
  if (keys.length) await chrome.storage.local.remove(keys)

  return keys
}

async function isMindWorldLoggedIn() {
  const stored = await chrome.storage.local.get(['mw_email'])
  const email = stored.mw_email
  return typeof email === 'string' && email.includes('@')
}

function broadcastLocalStateCleared() {
  chrome.tabs.query({ url: MW_HOST_PATTERNS }, (tabs) => {
    tabs.forEach((tab) => {
      if (tab.id) {
        chrome.tabs.sendMessage(tab.id, { type: 'LOCAL_STATE_CLEARED' }).catch(() => {})
      }
    })
  })
  chrome.runtime.sendMessage({ type: 'LOCAL_STATE_CLEARED' }).catch(() => {})
}
