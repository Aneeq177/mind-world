/* Shared Mind World chrome.storage.local helpers (popup, background, content). */

const MW_STORAGE_PREFIX = 'mw_'

const MW_HOST_PATTERNS = [
  'https://claude.ai/*',
  'https://chatgpt.com/*',
  'https://gemini.google.com/*',
  'https://perplexity.ai/*'
]

// Platforms with dedicated message-scraping selectors (auto-save + rich context capture).
const MW_KNOWN_PLATFORM_HOSTS = ['claude.ai', 'chatgpt.com', 'gemini.google.com', 'perplexity.ai']

// Our own web app / API — never show the input dock there even in Universal Mode.
const MW_OWN_HOSTS = ['mind-world.app', 'mind-world-app-mv4yv.ondigitalocean.app']

// Broad origin patterns requested at runtime for Universal Mode (Improve on any AI chat site).
const MW_UNIVERSAL_ORIGINS = ['https://*/*', 'http://*/*']

function isMindWorldKnownPlatform(hostname) {
  const h = hostname || (typeof window !== 'undefined' ? window.location.hostname : '')
  return MW_KNOWN_PLATFORM_HOSTS.some((known) => h.includes(known))
}

function isMindWorldOwnHost(hostname) {
  const h = hostname || (typeof window !== 'undefined' ? window.location.hostname : '')
  return MW_OWN_HOSTS.some((own) => h.includes(own))
}

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

  await deleteOnDeviceMemory()
  return keys
}

/* Delete the on-device memory database (memory/schema.js MW_DB_NAME). Only
 * from extension contexts: in a content script indexedDB is the host page's. */
function deleteOnDeviceMemory() {
  if (typeof location === 'undefined' || location.protocol !== 'chrome-extension:') return Promise.resolve()
  if (typeof indexedDB === 'undefined') return Promise.resolve()
  return new Promise((resolve) => {
    const req = indexedDB.deleteDatabase('mind-world-memory')
    req.onsuccess = req.onerror = req.onblocked = () => resolve()
  })
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
