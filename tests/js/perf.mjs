/* Browser perf for on-device memory, using the extension's own Transformers.js
 * build and model with the same settings as offscreen.js. Reports model load,
 * indexing throughput, query embedding latency, and index search time at
 * large-history sizes. Results land in window.__mwPerf for automation. */
import * as transformers from '../../extension/vendor/transformers/transformers.min.js'
import { createEmbedder } from '../../extension/memory/embedder-core.mjs'

const out = document.getElementById('out')
const log = (line) => { out.textContent = (out.textContent === 'running…' ? '' : out.textContent + '\n') + line }
const params = new URLSearchParams(location.search)
const device = params.get('device') || 'wasm'
const base = new URL('../../extension/', location.href).href

transformers.env.allowRemoteModels = false
transformers.env.allowLocalModels = true
transformers.env.localModelPath = base + 'models/'
transformers.env.backends.onnx.wasm.wasmPaths = base + 'vendor/transformers/'
// Same rule as offscreen.js: threads only when the page is cross-origin isolated.
transformers.env.backends.onnx.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1

const conversation = (i) => {
  const topics = ['pandas merge duplicates', 'marathon taper plan', 'sourdough starter feeding', 'react state bug', 'grad school essay', 'kubernetes ingress hosts']
  const t = topics[i % topics.length]
  return Array.from({ length: 12 }, (_, j) => `[${j % 2 ? 'assistant' : 'user'}] Message ${j} about ${t}. ` + 'Some detailed discussion of the problem and the approach we should take next. '.repeat(6)).join('\n\n')
}

const result = { device, threads: transformers.env.backends.onnx.wasm.numThreads, crossOriginIsolated: self.crossOriginIsolated, userAgent: navigator.userAgent }
try {
  let t = performance.now()
  const embedder = await createEmbedder(transformers, { device, dtype: 'fp32' })
  await embedder.embed(['warmup'])
  result.model_load_ms = Math.round(performance.now() - t)
  log(`device ${embedder.device || device}, ${result.threads} thread(s): model loaded and warm in ${result.model_load_ms} ms`)

  const inputs = []
  for (let i = 0; inputs.length < 256; i++) {
    const text = conversation(i)
    inputs.push(...mwChunkEmbedInputs(`Chat ${i}`, text, mwChunkSpans(text)))
  }
  inputs.length = 256
  t = performance.now()
  for (let i = 0; i < inputs.length; i += 32) await embedder.embed(inputs.slice(i, i + 32))
  const indexSec = (performance.now() - t) / 1000
  result.index_chunks_per_s = Math.round(inputs.length / indexSec)
  const chunksPerConv = 6
  result.est_minutes_per_1000_conversations = Math.round(((1000 * chunksPerConv) / result.index_chunks_per_s / 60) * 10) / 10
  log(`indexing: ${result.index_chunks_per_s} chunks/s (~${result.est_minutes_per_1000_conversations} min per 1,000 conversations at ${chunksPerConv} chunks each)`)

  const lat = []
  for (const q of ['why does my pandas merge duplicate rows', 'help me plan my marathon taper', 'write a bio about me', 'fix my react state bug', 'grad school essay outline']) {
    t = performance.now()
    await embedder.embed([q])
    lat.push(performance.now() - t)
  }
  lat.sort((a, b) => a - b)
  result.query_embed_ms_p50 = Math.round(lat[2])
  result.query_embed_ms_max = Math.round(lat[4])
  log(`query embedding: p50 ${result.query_embed_ms_p50} ms, max ${result.query_embed_ms_max} ms`)

  result.search = {}
  for (const n of [5000, 20000, 50000]) {
    const chunks = []
    for (let i = 0; i < n; i++) {
      const v = new Float32Array(MW_EMBED_DIM)
      for (let d = 0; d < MW_EMBED_DIM; d++) v[d] = Math.random() - 0.5
      const norm = Math.hypot(...v)
      for (let d = 0; d < MW_EMBED_DIM; d++) v[d] /= norm
      chunks.push({ conversation_id: `c${i % (n / 6)}`, start: 0, end: 100, vector: v, terms: ['merg', 'panda', `t${i % 500}`] })
    }
    t = performance.now()
    const index = new MwVectorIndex().build(chunks)
    const buildMs = performance.now() - t
    const q = chunks[7].vector
    t = performance.now()
    for (let r = 0; r < 5; r++) { index.search(q, MW_CHUNK_CANDIDATES); index.keywordSearch('pandas merge t42', q, MW_KEYWORD_CANDIDATES) }
    const searchMs = (performance.now() - t) / 5
    result.search[n] = { build_ms: Math.round(buildMs), search_ms: Math.round(searchMs * 10) / 10 }
    log(`index of ${n.toLocaleString()} chunks: build ${Math.round(buildMs)} ms, vector + keyword search ${result.search[n].search_ms} ms`)
  }
  result.ok = true
} catch (err) {
  result.ok = false
  result.error = String(err && err.message || err)
  log(`failed: ${result.error}`)
}
window.__mwPerf = result
