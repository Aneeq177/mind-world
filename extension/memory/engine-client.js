/* Service-worker side of the on-device memory engine (offscreen.js). */

const MW_OFFSCREEN_URL = 'offscreen.html'
let mwOffscreenCreating = null

async function mwHasOffscreenDocument() {
  if (chrome.offscreen.hasDocument) return chrome.offscreen.hasDocument()
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [chrome.runtime.getURL(MW_OFFSCREEN_URL)]
  })
  return contexts.length > 0
}

async function mwEnsureOffscreen() {
  if (await mwHasOffscreenDocument()) return
  if (!mwOffscreenCreating) {
    mwOffscreenCreating = chrome.offscreen.createDocument({
      url: MW_OFFSCREEN_URL,
      reasons: ['WORKERS'],
      justification: 'Runs the on-device embedding model and memory search so chat history never leaves the device.'
    }).catch((err) => {
      // A concurrent caller may have created it first.
      if (!String(err && err.message).includes('single offscreen')) throw err
    }).finally(() => { mwOffscreenCreating = null })
  }
  await mwOffscreenCreating
}

async function mwEngineCall(type, payload = {}) {
  await mwEnsureOffscreen()
  const res = await chrome.runtime.sendMessage({ target: 'mw-offscreen', type, ...payload })
  if (!res) throw new Error('Memory engine did not respond')
  if (!res.ok) throw new Error(res.error || 'Memory engine failed')
  return res.result
}

const MwEngine = {
  warm: () => mwEngineCall('MW_ENGINE_WARM'),
  status: () => mwEngineCall('MW_ENGINE_STATUS'),
  index: (conversations, { force = false } = {}) => mwEngineCall('MW_ENGINE_INDEX', { conversations, force }),
  search: (queries, { vectorK = 60, keywordK = 30 } = {}) => mwEngineCall('MW_ENGINE_SEARCH', { queries, vectorK, keywordK })
}
