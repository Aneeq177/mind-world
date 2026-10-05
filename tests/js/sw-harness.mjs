/* Loads the real extension service worker (background.js and every memory
 * script it imports) into a vm context with in-memory chrome.* stubs,
 * fake-indexeddb, and a scripted fetch. The offscreen engine is replaced by
 * the same pipeline offscreen.js runs, using the Node build of Transformers.js
 * and the bundled model, so search is real. */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import * as transformers from '@huggingface/transformers'
import { createEmbedder } from '../../extension/memory/embedder-core.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const extDir = join(here, '..', '..', 'extension')

transformers.env.allowRemoteModels = false
transformers.env.localModelPath = join(extDir, 'models') + '/'
let embedderPromise = null
export const getEmbedder = () => (embedderPromise ||= createEmbedder(transformers, { device: 'cpu', dtype: 'fp32' }))

function makeChrome(storage, listeners) {
  const pick = (keys) => {
    if (keys === null || keys === undefined) return { ...storage }
    if (typeof keys === 'string') keys = [keys]
    if (Array.isArray(keys)) return Object.fromEntries(keys.filter((k) => k in storage).map((k) => [k, storage[k]]))
    return Object.fromEntries(Object.entries(keys).map(([k, d]) => [k, k in storage ? storage[k] : d]))
  }
  const fire = (changes) => {
    if (Object.keys(changes).length) for (const l of listeners.storage) l(changes, 'local')
  }
  const cbOrPromise = (value, cb) => { if (cb) { cb(value); return undefined } return Promise.resolve(value) }
  return {
    storage: {
      local: {
        get: (keys, cb) => cbOrPromise(structuredClone(pick(keys)), cb),
        set: (obj, cb) => {
          const changes = {}
          for (const [k, v] of Object.entries(obj)) {
            changes[k] = { oldValue: storage[k], newValue: v }
            storage[k] = structuredClone(v)
          }
          fire(changes)
          return cbOrPromise(undefined, cb)
        },
        remove: (keys, cb) => {
          const changes = {}
          for (const k of [].concat(keys)) { if (k in storage) { changes[k] = { oldValue: storage[k] }; delete storage[k] } }
          fire(changes)
          return cbOrPromise(undefined, cb)
        }
      },
      onChanged: { addListener: (l) => listeners.storage.push(l) }
    },
    runtime: {
      id: 'test-extension',
      onMessage: { addListener: (l) => listeners.message.push(l) },
      sendMessage: () => Promise.resolve(undefined),
      getURL: (p) => `chrome-extension://test-extension/${p}`,
      getContexts: async () => []
    },
    tabs: {
      query: (_q, cb) => cbOrPromise([], cb),
      onUpdated: { addListener: () => {} },
      sendMessage: () => Promise.resolve(),
      remove: () => Promise.resolve(),
      create: async (opts) => { listeners.tabsCreated.push(opts); return { id: 99, ...opts } }
    },
    commands: { onCommand: { addListener: () => {} } },
    scripting: {
      getRegisteredContentScripts: async () => [],
      registerContentScripts: async () => {},
      unregisterContentScripts: async () => {}
    },
    permissions: { contains: async () => false },
    action: { openPopup: async () => {} },
    offscreen: { hasDocument: async () => true, createDocument: async () => {} }
  }
}

/* fetchRoutes: { 'POST /path' or 'https://host/path': (body, init) => response JSON | Response } */
export async function loadServiceWorker({ storage = {}, fetchRoutes = {}, indexedDB = new IDBFactory() } = {}) {
  const listeners = { storage: [], message: [], tabsCreated: [] }
  const fetchLog = []
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url)
    const method = (init.method || 'GET').toUpperCase()
    let body = init.body
    if (typeof body === 'string') { try { body = JSON.parse(body) } catch (_) {} }
    fetchLog.push({ url: String(url), path: u.pathname, method, headers: init.headers || {}, body })
    const handler = fetchRoutes[`${method} ${u.pathname}`] || fetchRoutes[`${u.origin}${u.pathname}`]
    if (!handler) return new Response(JSON.stringify({ detail: `no stub for ${method} ${u.pathname}` }), { status: 404 })
    const out = await handler(body, init)
    if (out instanceof Response) return out
    return new Response(JSON.stringify(out), { status: 200, headers: { 'content-type': 'application/json' } })
  }

  const context = vm.createContext({
    console,
    chrome: makeChrome(storage, listeners),
    fetch: fetchImpl,
    Response,
    FormData,
    Blob,
    URL,
    TextEncoder,
    TextDecoder,
    crypto: globalThis.crypto,
    indexedDB,
    IDBKeyRange,
    structuredClone,
    location: { protocol: 'chrome-extension:' },
    setTimeout: (fn, ms) => { const t = setTimeout(fn, ms); t.unref(); return t },
    clearTimeout,
    setInterval: () => 0,
    clearInterval: () => {}
  })
  context.self = context
  context.importScripts = (...files) => {
    for (const f of files) vm.runInContext(readFileSync(join(extDir, f), 'utf8'), context, { filename: f })
  }
  vm.runInContext(readFileSync(join(extDir, 'background.js'), 'utf8'), context, { filename: 'background.js' })
  vm.runInContext(readFileSync(join(extDir, 'memory/vector-index.js'), 'utf8'), context, { filename: 'vector-index.js' })

  // Top-level const/class bindings are not properties of the global object.
  const get = (name) => vm.runInContext(name, context)
  const MwLocalDB = get('MwLocalDB')
  const MwVectorIndex = get('MwVectorIndex')
  const embedder = await getEmbedder()
  const engineCalls = []
  vm.runInContext('globalThis.__defineEngine = (impl) => { MwEngine.index = impl.index; MwEngine.search = impl.search; MwEngine.status = impl.status; MwEngine.warm = impl.status }', context)
  context.__defineEngine({
    // Same steps as offscreen.js indexConversations / search.
    index: async (conversations, { force = false } = {}) => {
      engineCalls.push({ type: 'index', count: conversations.length })
      let indexed = 0
      let skipped = 0
      for (const conv of conversations) {
        const fullText = conv.full_text || ''
        const digest = await context.mwTextHash(fullText)
        const stored = await MwLocalDB.getConversation(conv.id)
        const record = { ...conv, text_hash: digest, index_version: 1 }
        if (!force && stored && stored.text_hash === digest) { await MwLocalDB.putConversation(record); skipped++; continue }
        const spans = context.mwChunkSpans(fullText)
        const vectors = spans.length ? await embedder.embed(context.mwChunkEmbedInputs(conv.title, fullText, spans)) : []
        const chunks = spans.map(([start, end], i) => ({
          id: `${conv.id}:${i}`, conversation_id: conv.id, chunk_index: i, start, end, vector: vectors[i],
          terms: context.mwKeywordTerms(`${conv.title || ''} ${fullText.slice(start, end)}`)
        }))
        await MwLocalDB.putConversationWithChunks(record, chunks)
        indexed++
      }
      return { indexed, skipped }
    },
    search: async (queries, { vectorK = 60, keywordK = 30 } = {}) => {
      engineCalls.push({ type: 'search', queries })
      const chunks = []
      await MwLocalDB.forEachChunk((c) => chunks.push(c))
      const index = new MwVectorIndex().build(chunks)
      const vectors = await embedder.embed(queries.map((q) => q.text || ''))
      return queries.map((q, i) => ({
        vector: index.search(vectors[i], vectorK),
        keyword: q.keywords ? index.keywordSearch(q.text || '', vectors[i], keywordK) : []
      }))
    },
    status: async () => ({ ready: true, device: 'cpu' })
  })

  /* Deliver a runtime message like Chrome does; sender defaults to an extension page. */
  const send = (message, sender = { id: 'test-extension' }) => new Promise((resolve, reject) => {
    let handled = false
    for (const l of listeners.message) {
      const keepOpen = l(message, sender, (res) => resolve(res))
      if (keepOpen === true) handled = true
    }
    if (!handled) reject(new Error(`no handler for ${message.type}`))
  })

  return { context, get, storage, fetchLog, engineCalls, send, listeners }
}
