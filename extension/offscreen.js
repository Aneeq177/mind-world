/* On-device memory engine (offscreen document).
 *
 * Owns the embedding model and the in-memory search index, both of which are
 * too heavy for the service worker (it sleeps, and has no WebGPU). Indexing
 * writes chunks straight to IndexedDB so vectors never cross extension
 * messaging. Messages carry target: 'mw-offscreen' and db: the signed-in
 * account's database name.
 */
import * as transformers from './vendor/transformers/transformers.min.js'
import { createEmbedder } from './memory/embedder-core.mjs'

transformers.env.allowRemoteModels = false
transformers.env.allowLocalModels = true
transformers.env.localModelPath = chrome.runtime.getURL('models/')
transformers.env.backends.onnx.wasm.wasmPaths = chrome.runtime.getURL('vendor/transformers/')
// Threaded WASM needs cross-origin isolation (COOP/COEP in the manifest); without it, stay single-threaded.
transformers.env.backends.onnx.wasm.numThreads = self.crossOriginIsolated
  ? Math.min(4, navigator.hardwareConcurrency || 1)
  : 1

const DTYPE = 'fp32'
const state = { embedder: null, loading: null, error: null, index: null, indexDb: null, indexStamp: null }
let queue = Promise.resolve()

function serialize(fn) {
  const run = queue.then(fn, fn)
  queue = run.catch(() => {})
  return run
}

async function loadEmbedder() {
  if (state.embedder) return state.embedder
  if (!state.loading) {
    state.loading = (async () => {
      const devices = navigator.gpu ? ['webgpu', 'wasm'] : ['wasm']
      let lastError = null
      for (const device of devices) {
        try {
          const embedder = await createEmbedder(transformers, { device, dtype: DTYPE })
          await embedder.embed(['warmup'])
          state.embedder = embedder
          state.error = null
          return embedder
        } catch (err) {
          lastError = err
          console.warn(`[mw-engine] ${device} backend unavailable:`, err)
        }
      }
      state.error = String((lastError && lastError.message) || lastError || 'embedder failed to load')
      state.loading = null
      throw lastError || new Error(state.error)
    })()
  }
  return state.loading
}

/* The account's database, named by the service worker on every message. */
function memoryDb(name) {
  if (!name) throw new Error('No account database named')
  return MwLocalDB.forName(name)
}

async function ensureIndex(dbName) {
  const db = memoryDb(dbName)
  const stamp = await db.getMeta('index_stamp')
  if (state.index && state.indexDb === dbName && state.indexStamp === stamp) return state.index
  const chunks = []
  await db.forEachChunk((c) => chunks.push(c))
  state.index = new MwVectorIndex().build(chunks)
  state.indexDb = dbName
  state.indexStamp = stamp
  return state.index
}

async function indexConversations(dbName, conversations, { force = false } = {}) {
  const db = memoryDb(dbName)
  const embedder = await loadEmbedder()
  let indexed = 0
  let skipped = 0
  for (const conv of conversations) {
    const fullText = conv.full_text || ''
    const digest = await mwTextHash(fullText)
    const stored = await db.getConversation(conv.id)
    const record = { ...conv, text_hash: digest, index_version: MW_INDEX_VERSION }
    if (!force && stored && stored.text_hash === digest && stored.index_version === MW_INDEX_VERSION) {
      await db.putConversation(record)
      skipped++
      continue
    }
    const spans = mwChunkSpans(fullText)
    const vectors = spans.length ? await embedder.embed(mwChunkEmbedInputs(conv.title, fullText, spans)) : []
    const chunks = spans.map(([start, end], i) => ({
      id: `${conv.id}:${i}`,
      conversation_id: conv.id,
      chunk_index: i,
      start,
      end,
      vector: vectors[i],
      terms: mwKeywordTerms(`${conv.title || ''} ${fullText.slice(start, end)}`)
    }))
    await db.putConversationWithChunks(record, chunks)
    indexed++
  }
  return { indexed, skipped }
}

async function search(dbName, queries, vectorK, keywordK) {
  const embedder = await loadEmbedder()
  const index = await ensureIndex(dbName)
  const vectors = await embedder.embed(queries.map((q) => q.text || ''))
  return queries.map((q, i) => ({
    vector: index.search(vectors[i], vectorK),
    keyword: q.keywords ? index.keywordSearch(q.text || '', vectors[i], keywordK) : []
  }))
}

async function status(dbName) {
  return {
    ready: !!state.embedder,
    loading: !!state.loading && !state.embedder,
    device: state.embedder ? state.embedder.device : null,
    dtype: DTYPE,
    threads: transformers.env.backends.onnx.wasm.numThreads,
    error: state.error,
    chunks: state.index && state.indexDb === dbName ? state.index.size : await memoryDb(dbName).countChunks()
  }
}

const handlers = {
  MW_ENGINE_WARM: (m) => loadEmbedder().then(() => ensureIndex(m.db)).then(() => status(m.db)),
  MW_ENGINE_STATUS: (m) => status(m.db),
  MW_ENGINE_INDEX: (m) => serialize(() => indexConversations(m.db, m.conversations || [], { force: !!m.force })),
  MW_ENGINE_SEARCH: (m) => search(m.db, m.queries || [], m.vectorK || 60, m.keywordK || 30)
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.target !== 'mw-offscreen') return false
  const handler = handlers[message.type]
  if (!handler) return false
  Promise.resolve()
    .then(() => handler(message))
    .then((result) => sendResponse({ ok: true, result }))
    .catch((err) => sendResponse({ ok: false, error: String((err && err.message) || err) }))
  return true
})
