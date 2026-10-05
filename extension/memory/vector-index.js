/* In-memory chunk index for on-device search. Requires memory/schema.js and,
 * for keyword search, mwKeywordTerms from memory/retrieval.js.
 *
 * Vectors are L2-normalized at embed time, so cosine similarity is a dot
 * product. Brute force over a flat Float32Array: 50k chunks x 384 dims is
 * ~19M multiply-adds, a few milliseconds.
 */

class MwVectorIndex {
  constructor(dim = MW_EMBED_DIM) {
    this.dim = dim
    this.clear()
  }

  clear() {
    this.size = 0
    this.conversationIds = []
    this.starts = []
    this.ends = []
    this.vectors = new Float32Array(0)
    this.postings = new Map()
  }

  /* chunks: iterable of { conversation_id, start, end, vector, terms } */
  build(chunks) {
    const list = Array.from(chunks).filter((c) => c && c.vector && c.vector.length === this.dim)
    this.clear()
    this.size = list.length
    this.vectors = new Float32Array(list.length * this.dim)
    list.forEach((c, i) => {
      this.conversationIds.push(c.conversation_id)
      this.starts.push(c.start)
      this.ends.push(c.end)
      this.vectors.set(c.vector, i * this.dim)
      for (const term of new Set(c.terms || [])) {
        let p = this.postings.get(term)
        if (!p) this.postings.set(term, (p = []))
        p.push(i)
      }
    })
    return this
  }

  similarityAt(i, query) {
    const v = this.vectors
    const off = i * this.dim
    let dot = 0
    for (let d = 0; d < this.dim; d++) dot += v[off + d] * query[d]
    return dot
  }

  hit(i, extra) {
    return {
      conversation_id: this.conversationIds[i],
      start_char: this.starts[i],
      end_char: this.ends[i],
      ...extra
    }
  }

  /* Top-k chunks by cosine similarity: [{ conversation_id, start_char, end_char, similarity }] */
  search(query, k) {
    if (!this.size) return []
    const scores = new Float32Array(this.size)
    for (let i = 0; i < this.size; i++) scores[i] = this.similarityAt(i, query)
    return topK(scores, k).map((i) => this.hit(i, { similarity: scores[i] }))
  }

  /* Chunks scored by the share of the query's rarity-weighted terms they
   * contain (0..1), with their vector similarity to the query. Mirrors
   * match_keyword_chunks in backend/migrations/016_keyword_search.sql: idf is
   * BM25-style over this user's chunks, and query terms the user never wrote
   * still count in the denominator so unrelated drafts score low. */
  keywordSearch(queryText, query, k) {
    if (!this.size) return []
    const terms = [...new Set(mwKeywordTerms(queryText))]
    if (!terms.length) return []
    const n = Math.max(this.size, 1)
    let totalIdf = 0
    const weights = new Float64Array(this.size)
    const matched = new Uint16Array(this.size)
    for (const term of terms) {
      const posting = this.postings.get(term) || []
      const df = posting.length
      const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5))
      totalIdf += idf
      for (const i of posting) {
        weights[i] += idf
        matched[i] += 1
      }
    }
    if (totalIdf <= 0) return []
    const candidates = []
    for (let i = 0; i < this.size; i++) if (matched[i]) candidates.push(i)
    candidates.sort((a, b) => weights[b] - weights[a])
    return candidates.slice(0, k).map((i) => this.hit(i, {
      keyword_score: weights[i] / totalIdf,
      matched_terms: matched[i],
      similarity: this.similarityAt(i, query)
    }))
  }
}

function topK(scores, k) {
  const n = scores.length
  if (k >= n) return Array.from({ length: n }, (_, i) => i).sort((a, b) => scores[b] - scores[a])
  // Min-heap of the best k indices.
  const heap = []
  const less = (a, b) => scores[a] < scores[b]
  const up = (i) => {
    while (i > 0) {
      const p = (i - 1) >> 1
      if (!less(heap[i], heap[p])) break
      ;[heap[i], heap[p]] = [heap[p], heap[i]]
      i = p
    }
  }
  const down = (i) => {
    for (;;) {
      const l = 2 * i + 1
      const r = l + 1
      let m = i
      if (l < heap.length && less(heap[l], heap[m])) m = l
      if (r < heap.length && less(heap[r], heap[m])) m = r
      if (m === i) break
      ;[heap[i], heap[m]] = [heap[m], heap[i]]
      i = m
    }
  }
  for (let i = 0; i < n; i++) {
    if (heap.length < k) {
      heap.push(i)
      up(heap.length - 1)
    } else if (scores[i] > scores[heap[0]]) {
      heap[0] = i
      down(0)
    }
  }
  return heap.sort((a, b) => scores[b] - scores[a])
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { MwVectorIndex, topK }
}
