/* Ship gate: on-device retrieval recall is no worse than cloud.
 *
 * Runs the extension's retrieval (JS chunker, the bundled MiniLM, the
 * in-memory vector + keyword index, the hybrid merge) over the private
 * labeled set in backend/evals/retrieval (corpus.json + cases.json), scores it
 * exactly like retrieval_eval.py, and compares with a cloud run of the same
 * cases:
 *
 *   backend\venv\Scripts\python.exe backend/evals/retrieval/retrieval_eval.py \
 *       --strategy chunked_cutoff --no-rerank --out results/cloud_chunked_cutoff.json
 *   npm run parity:retrieval            (from tests/js)
 *
 * Two local stages are reported: "vector" mirrors chunked_cutoff (the same
 * pipeline as the cloud run), "hybrid" adds keyword search as LocalProvider
 * does. About-me query rewrites need an LLM and are left out on both sides,
 * and the reranker is shared (it runs on the same candidates in every mode).
 *
 * Gate: hybrid hit_rate@5 and recall@15 >= cloud. Exits 1 on failure.
 * Writes results/local_parity.json (gitignored: it names private chats) and
 * a metrics-only summaries/local_parity.json.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import * as transformers from '@huggingface/transformers'
import { createEmbedder } from '../../extension/memory/embedder-core.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..')
const evalDir = join(root, 'backend', 'evals', 'retrieval')
const arg = (name, fallback) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback)
const corpusPath = arg('--corpus', join(evalDir, 'corpus.json'))
const casesPath = arg('--cases', join(evalDir, 'cases.json'))
const cloudPath = arg('--cloud', join(evalDir, 'results', 'cloud_chunked_cutoff.json'))
const outPath = arg('--out', join(evalDir, 'results', 'local_parity.json'))

const TOP_K = 5
const CANDIDATE_K = 15

const ctx = vm.createContext({ console })
for (const f of ['memory/schema.js', 'memory/chunker.js', 'memory/retrieval.js', 'memory/vector-index.js']) {
  vm.runInContext(readFileSync(join(root, 'extension', f), 'utf8'), ctx, { filename: f })
}
const js = (name) => vm.runInContext(name, ctx)
const [mwChunkSpans, mwChunkEmbedInputs, mwKeywordTerms] = ['mwChunkSpans', 'mwChunkEmbedInputs', 'mwKeywordTerms'].map(js)
const [mwGroupChunkHits, mwGroupKeywordHits, mwApplyRelevanceCutoff, mwMergeHybrid] =
  ['mwGroupChunkHits', 'mwGroupKeywordHits', 'mwApplyRelevanceCutoff', 'mwMergeHybrid'].map(js)
const [MwVectorIndex, MW_CHUNK_CANDIDATES, MW_KEYWORD_CANDIDATES] = ['MwVectorIndex', 'MW_CHUNK_CANDIDATES', 'MW_KEYWORD_CANDIDATES'].map(js)

const loadList = (p, key) => { const d = JSON.parse(readFileSync(p, 'utf8')); return Array.isArray(d) ? d : d[key] }
const corpus = loadList(corpusPath, 'conversations').filter((c) => c.id && (c.full_text || c.preview))
const cases = loadList(casesPath, 'cases')
const byId = new Map(corpus.map((c) => [c.id, c]))

transformers.env.allowRemoteModels = false
transformers.env.localModelPath = join(root, 'extension', 'models') + '/'
const embedder = await createEmbedder(transformers, { device: 'cpu', dtype: 'fp32' })

console.log(`indexing ${corpus.length} conversations on-device...`)
const t0 = performance.now()
const chunks = []
const pending = []
for (const conv of corpus) {
  const text = conv.full_text || conv.preview || ''
  const spans = mwChunkSpans(text)
  const inputs = mwChunkEmbedInputs(conv.title || 'Untitled', text, spans)
  spans.forEach(([start, end], i) => {
    const chunk = { conversation_id: conv.id, start, end, terms: mwKeywordTerms(`${conv.title || ''} ${text.slice(start, end)}`) }
    chunks.push(chunk)
    pending.push([chunk, inputs[i]])
  })
}
for (let i = 0; i < pending.length; i += 64) {
  const batch = pending.slice(i, i + 64)
  const vectors = await embedder.embed(batch.map(([, input]) => input))
  batch.forEach(([chunk], j) => { chunk.vector = vectors[j] })
}
const indexMs = performance.now() - t0
const index = new MwVectorIndex().build(chunks)
console.log(`  ${chunks.length} chunks in ${(indexMs / 1000).toFixed(1)}s (${(chunks.length / (indexMs / 1000)).toFixed(0)} chunks/s on CPU)`)

function enrich(h) {
  const c = byId.get(h.conversation_id)
  const text = c.full_text || c.preview || ''
  return { ...h, chunk_text: text.slice(h.start_char, h.end_char), title: c.title || 'Untitled', preview: c.preview || text.slice(0, 300), created_at: c.created_at }
}

function scoreList(ids, c) {
  const rel = new Set(c.relevant || [])
  const ok = new Set([...rel, ...(c.acceptable || [])])
  const first = ids.findIndex((x) => rel.has(x))
  return { hit: first >= 0, rank: first >= 0 ? first + 1 : null, returned: ids.length, unrelated: ids.filter((x) => !ok.has(x)).length }
}

const ratio = (a, b) => (b ? Math.round((a / b) * 1e4) / 1e4 : null)
function aggregate(scored) {
  const answerable = scored.filter(([c]) => (c.relevant || []).length)
  const negatives = scored.filter(([c]) => !(c.relevant || []).length)
  const returned = scored.reduce((s, [, x]) => s + x.returned, 0)
  const unrelated = scored.reduce((s, [, x]) => s + x.unrelated, 0)
  const out = {
    n_answerable: answerable.length,
    n_no_match: negatives.length,
    hit_rate: ratio(answerable.filter(([, x]) => x.hit).length, answerable.length),
    mrr: ratio(answerable.reduce((s, [, x]) => s + (x.rank ? 1 / x.rank : 0), 0), answerable.length),
    unrelated_rate: ratio(unrelated, returned),
    avg_unrelated_per_draft: ratio(unrelated, scored.length)
  }
  if (negatives.length) out.no_match_fp = ratio(negatives.filter(([, x]) => x.returned > 0).length, negatives.length)
  return out
}

const stages = { vector: { top5: [], top15: [] }, hybrid: { top5: [], top15: [] } }
const perCase = []
const searchMs = []
for (const c of cases) {
  const s = performance.now()
  const [q] = await embedder.embed([c.draft])
  const vec = mwGroupChunkHits(index.search(q, MW_CHUNK_CANDIDATES).map(enrich))
  const kw = mwGroupKeywordHits(index.keywordSearch(c.draft, q, MW_KEYWORD_CANDIDATES).map(enrich))
  const lists = {
    vector: mwApplyRelevanceCutoff(vec).slice(0, CANDIDATE_K),
    hybrid: vec.length ? mwMergeHybrid([vec], [kw], {}).slice(0, CANDIDATE_K) : []
  }
  searchMs.push(performance.now() - s)
  const row = { id: c.id, category: c.category }
  for (const [name, list] of Object.entries(lists)) {
    const ids = list.map((x) => x.id)
    const s5 = scoreList(ids.slice(0, TOP_K), c)
    const s15 = scoreList(ids, c)
    stages[name].top5.push([c, s5])
    stages[name].top15.push([c, s15])
    row[name] = { ids, top5: s5, top15: s15 }
  }
  perCase.push(row)
}

const summary = {}
for (const [name, st] of Object.entries(stages)) summary[name] = { top5: aggregate(st.top5), top15: aggregate(st.top15) }
const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return Math.round(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]) }

let cloud = null
if (existsSync(cloudPath)) {
  const r = JSON.parse(readFileSync(cloudPath, 'utf8'))
  cloud = { strategy: r.meta.strategy, top5: r.stages.vector_top5.overall, top15: r.stages.vector_top15.overall }
  const cloudCases = new Map(r.cases.map((x) => [x.id, x.vector_top15.map((y) => y.id)]))
  let overlap = 0
  let n = 0
  for (const row of perCase) {
    const theirs = cloudCases.get(row.id)
    if (!theirs) continue
    const a = new Set(row.vector.ids.slice(0, TOP_K))
    const b = new Set(theirs.slice(0, TOP_K))
    const union = new Set([...a, ...b])
    overlap += union.size ? [...a].filter((x) => b.has(x)).length / union.size : 1
    n++
  }
  cloud.top5_jaccard_vs_local_vector = n ? Math.round((overlap / n) * 1e4) / 1e4 : null
}

const result = {
  meta: {
    corpus_size: corpus.length,
    n_cases: cases.length,
    chunks: chunks.length,
    index_seconds: Math.round(indexMs / 100) / 10,
    search_ms_p50: pct(searchMs, 50),
    search_ms_p95: pct(searchMs, 95),
    model: 'Xenova/all-MiniLM-L6-v2 fp32 (cpu)'
  },
  local: summary,
  cloud,
  cases: perCase
}
mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, JSON.stringify(result, null, 2) + '\n')
// Metrics only, safe to commit next to the other public summaries.
const { cases: _private, ...publicSummary } = result
writeFileSync(join(evalDir, 'summaries', 'local_parity.json'), JSON.stringify(publicSummary, null, 2) + '\n')

const fmt = (o) => `hit@5 ${o.top5.hit_rate}  recall@15 ${o.top15.hit_rate}  mrr ${o.top5.mrr}  unrelated@5 ${o.top5.unrelated_rate}  no_match_fp ${o.top5.no_match_fp}`
console.log(`\nlocal vector  ${fmt(summary.vector)}`)
console.log(`local hybrid  ${fmt(summary.hybrid)}`)
console.log(`search p50 ${result.meta.search_ms_p50} ms, p95 ${result.meta.search_ms_p95} ms`)
if (!cloud) {
  console.log(`\nNo cloud run at ${cloudPath}; run retrieval_eval.py --strategy chunked_cutoff --no-rerank first.`)
  process.exit(1)
}
console.log(`cloud ${cloud.strategy}  ${fmt(cloud)}`)
console.log(`top-5 overlap (local vector vs cloud): ${cloud.top5_jaccard_vs_local_vector}`)
const pass = summary.hybrid.top5.hit_rate >= cloud.top5.hit_rate && summary.hybrid.top15.hit_rate >= cloud.top15.hit_rate
console.log(pass ? '\nPASS: on-device recall is no worse than cloud' : '\nFAIL: on-device recall is below cloud')
process.exit(pass ? 0 : 1)
