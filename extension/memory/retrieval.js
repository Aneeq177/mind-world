/* Chunk-level retrieval: group chunk hits into conversations, fuse vector and
 * keyword rankings, and build the excerpt Improve sends to the model.
 * Port of backend/services/retrieval.py (checked by tests/js golden fixtures).
 */

// Chunks pulled per query before grouping into conversations.
const MW_CHUNK_CANDIDATES = 60
const MW_MULTI_HIT_BONUS = 0.01
const MW_MAX_BONUS_HITS = 3
const MW_SNIPPET_CHARS = 600
const MW_EXCERPT_CHARS = 3000
const MW_OPENING_CHARS = 500
const MW_EXCERPT_GAP = '\n[...]\n'
// Relevance cutoff on best-chunk similarity, tuned with backend/evals/retrieval.
const MW_MIN_SIMILARITY = 0.36
const MW_MAX_GAP_FROM_TOP = 0.25
const MW_ABOUT_ME_MIN_SIMILARITY = 0.30
const MW_ABOUT_ME_PER_QUERY = 4
const MW_KEYWORD_CANDIDATES = 30
const MW_KEYWORD_MIN_SCORE = 0.45
const MW_KEYWORD_MIN_SIMILARITY = 0.30
const MW_KEYWORD_RRF_WEIGHT = 0.5
const MW_RRF_K = 60

function mwRound6(x) {
  return Math.round(x * 1e6) / 1e6
}

function mwNum(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/* Collapse chunk hits into one candidate per conversation, scored by its best
 * chunk plus a small bonus when several of its chunks match. Hits carry
 * conversation_id, similarity, start_char, end_char, and optionally
 * chunk_text, title, preview, created_at. */
function mwGroupChunkHits(hits) {
  const byConv = new Map()
  const sorted = [...hits].sort((a, b) => mwNum(b.similarity) - mwNum(a.similarity))
  for (const hit of sorted) {
    const convId = hit.conversation_id
    if (!convId) continue
    const sim = mwNum(hit.similarity)
    let conv = byConv.get(convId)
    if (!conv) {
      conv = {
        id: convId,
        title: hit.title || 'Untitled',
        preview: hit.preview || '',
        created_at: hit.created_at ?? null,
        similarity: sim,
        snippet: (hit.chunk_text || '').slice(0, MW_SNIPPET_CHARS),
        matched: []
      }
      byConv.set(convId, conv)
    }
    conv.matched.push({ start_char: Math.trunc(mwNum(hit.start_char)), end_char: Math.trunc(mwNum(hit.end_char)), similarity: sim })
  }
  for (const conv of byConv.values()) {
    const extra = Math.min(conv.matched.length - 1, MW_MAX_BONUS_HITS)
    conv.retrieval_score = mwRound6(conv.similarity + MW_MULTI_HIT_BONUS * extra)
  }
  return [...byConv.values()].sort((a, b) => b.retrieval_score - a.retrieval_score)
}

/* Drop candidates weak on their own or far behind the best one. */
function mwApplyRelevanceCutoff(candidates, minSimilarity = MW_MIN_SIMILARITY, maxGap = MW_MAX_GAP_FROM_TOP) {
  if (!candidates.length) return []
  const top = Math.max(...candidates.map((c) => mwNum(c.similarity)))
  const floor = Math.max(minSimilarity, top - maxGap)
  return candidates.filter((c) => mwNum(c.similarity) >= floor)
}

function mwMergeSpans(spans) {
  const out = []
  for (const [s, e] of [...spans].sort((a, b) => a[0] - b[0] || a[1] - b[1])) {
    if (out.length && s <= out[out.length - 1][1]) {
      out[out.length - 1][1] = Math.max(out[out.length - 1][1], e)
    } else {
      out.push([s, e])
    }
  }
  return out
}

function mwCoveredLength(spans) {
  return mwMergeSpans(spans).reduce((sum, [s, e]) => sum + (e - s), 0)
}

function mwUncovered(spans, start, end) {
  return mwCoveredLength([...spans, [start, end]]) - mwCoveredLength(spans)
}

/* The conversation's opening plus its best-matching chunks, in reading order,
 * capped at `budget` characters. Without matches, the opening alone. */
function mwBuildExcerpt(fullText, matched, budget = MW_EXCERPT_CHARS, openingChars = MW_OPENING_CHARS) {
  const text = fullText || ''
  if (!matched || !matched.length) return text.slice(0, budget)
  const n = text.length
  const spans = [[0, Math.min(openingChars, n)]]
  let remaining = budget - spans[0][1]
  const bySim = [...matched].sort((a, b) => mwNum(b.similarity) - mwNum(a.similarity))
  for (const m of bySim) {
    if (remaining <= 0) break
    const start = Math.max(0, Math.min(Math.trunc(mwNum(m.start_char)), n))
    let end = Math.max(start, Math.min(Math.trunc(mwNum(m.end_char)), n))
    const newChars = mwUncovered(spans, start, end)
    if (newChars === 0) continue
    if (newChars > remaining) end = start + remaining
    spans.push([start, end])
    remaining = budget - mwCoveredLength(spans)
  }
  return mwMergeSpans(spans)
    .filter(([s, e]) => e > s)
    .map(([s, e]) => text.slice(s, e).trim())
    .join(MW_EXCERPT_GAP)
}

/* Collapse keyword hits into one candidate per conversation, scored by its
 * best chunk's keyword_score; keyword_similarity is that chunk's similarity. */
function mwGroupKeywordHits(hits) {
  const byConv = new Map()
  const sorted = [...hits].sort((a, b) => mwNum(b.keyword_score) - mwNum(a.keyword_score))
  for (const hit of sorted) {
    const convId = hit.conversation_id
    if (!convId) continue
    const sim = mwNum(hit.similarity)
    let conv = byConv.get(convId)
    if (!conv) {
      conv = {
        id: convId,
        title: hit.title || 'Untitled',
        preview: hit.preview || '',
        created_at: hit.created_at ?? null,
        keyword_score: mwNum(hit.keyword_score),
        keyword_similarity: sim,
        snippet: (hit.chunk_text || '').slice(0, MW_SNIPPET_CHARS),
        matched: []
      }
      byConv.set(convId, conv)
    }
    conv.matched.push({ start_char: Math.trunc(mwNum(hit.start_char)), end_char: Math.trunc(mwNum(hit.end_char)), similarity: sim })
  }
  return [...byConv.values()]
}

function mwDedupeSpans(matched) {
  const best = new Map()
  for (const m of matched) {
    const key = `${m.start_char}:${m.end_char}`
    const prior = best.get(key)
    if (!prior || mwNum(m.similarity) > mwNum(prior.similarity)) best.set(key, m)
  }
  return [...best.values()]
}

/* Fuse grouped candidate lists (one vector and one keyword list per query) by
 * reciprocal rank fusion; see merge_hybrid in retrieval.py for the rules. */
function mwMergeHybrid(vectorLists, keywordLists, {
  minSimilarity = MW_MIN_SIMILARITY,
  maxGap = MW_MAX_GAP_FROM_TOP,
  keywordMin = MW_KEYWORD_MIN_SCORE,
  keywordMinSimilarity = MW_KEYWORD_MIN_SIMILARITY,
  perListCap = null
} = {}) {
  const cap = (list) => (perListCap == null ? list : list.slice(0, perListCap))
  const vectorQualified = new Set()
  for (const lst of vectorLists) {
    for (const c of cap(mwApplyRelevanceCutoff(lst, minSimilarity, maxGap))) vectorQualified.add(c.id)
  }
  const qualified = new Set(vectorQualified)
  for (const lst of keywordLists) {
    const strong = lst.filter((c) => mwNum(c.keyword_score) >= keywordMin && mwNum(c.keyword_similarity) >= keywordMinSimilarity)
    for (const c of cap(strong)) qualified.add(c.id)
  }

  const merged = new Map()
  for (const [lists, isVec] of [[vectorLists, true], [keywordLists, false]]) {
    for (const lst of lists) {
      lst.forEach((c, rank) => {
        if (!qualified.has(c.id)) return
        let conv = merged.get(c.id)
        if (!conv) {
          conv = { ...c, similarity: null, keyword_score: null, matched: [], retrieval_score: 0, _snippet_score: -1 }
          merged.set(c.id, conv)
        }
        const sim = mwNum(isVec ? c.similarity : c.keyword_similarity)
        if (conv.similarity === null || sim > conv.similarity) conv.similarity = sim
        if (!isVec) conv.keyword_score = Math.max(conv.keyword_score || 0, mwNum(c.keyword_score))
        const snippetScore = sim + (isVec === vectorQualified.has(c.id) ? 1 : 0)
        if (snippetScore > conv._snippet_score) {
          conv.snippet = c.snippet || ''
          conv._snippet_score = snippetScore
        }
        conv.matched = conv.matched.concat(c.matched || [])
        conv.retrieval_score += (isVec ? 1 : MW_KEYWORD_RRF_WEIGHT) / (MW_RRF_K + rank + 1)
      })
    }
  }

  const out = []
  for (const conv of merged.values()) {
    delete conv._snippet_score
    delete conv.keyword_similarity
    conv.matched = mwDedupeSpans(conv.matched)
    conv.retrieval_score = mwRound6(conv.retrieval_score)
    out.push(conv)
  }
  return out.sort((a, b) => b.retrieval_score - a.retrieval_score)
}

/* ---- Keyword terms ------------------------------------------------------
 * Approximates Postgres to_tsvector('english'): lowercase words, English
 * stopwords dropped, Porter-stemmed, at least 2 characters. Used both when
 * indexing chunks and when querying, so only internal consistency matters.
 */

const MW_STOPWORDS = new Set((
  'i me my myself we our ours ourselves you your yours yourself yourselves he him his himself she her hers ' +
  'herself it its itself they them their theirs themselves what which who whom this that these those am is are ' +
  'was were be been being have has had having do does did doing a an the and but if or because as until while of ' +
  'at by for with about against between into through during before after above below to from up down in out on ' +
  'off over under again further then once here there when where why how all any both each few more most other ' +
  'some such no nor not only own same so than too very s t can will just don should now'
).split(' '))

function mwPorterStem(w) {
  if (w.length <= 2) return w
  const isCons = (s, i) => {
    const c = s[i]
    if ('aeiou'.includes(c)) return false
    if (c === 'y') return i === 0 ? true : !isCons(s, i - 1)
    return true
  }
  const measure = (s) => {
    let m = 0
    let i = 0
    const n = s.length
    while (i < n && isCons(s, i)) i++
    while (i < n) {
      while (i < n && !isCons(s, i)) i++
      if (i >= n) break
      m++
      while (i < n && isCons(s, i)) i++
    }
    return m
  }
  const hasVowel = (s) => { for (let i = 0; i < s.length; i++) if (!isCons(s, i)) return true; return false }
  const endsDoubleCons = (s) => s.length >= 2 && s[s.length - 1] === s[s.length - 2] && isCons(s, s.length - 1)
  const cvc = (s) => {
    const n = s.length
    if (n < 3) return false
    if (!isCons(s, n - 1) || isCons(s, n - 2) || !isCons(s, n - 3)) return false
    return !'wxy'.includes(s[n - 1])
  }
  const replace = (s, suffix, repl, minM) => {
    if (!s.endsWith(suffix)) return null
    const stem = s.slice(0, -suffix.length)
    return measure(stem) > minM ? stem + repl : s
  }

  // Step 1a
  if (w.endsWith('sses')) w = w.slice(0, -2)
  else if (w.endsWith('ies')) w = w.slice(0, -2)
  else if (!w.endsWith('ss') && w.endsWith('s')) w = w.slice(0, -1)
  // Step 1b
  let step1bExtra = false
  if (w.endsWith('eed')) {
    if (measure(w.slice(0, -3)) > 0) w = w.slice(0, -1)
  } else if (w.endsWith('ed') && hasVowel(w.slice(0, -2))) {
    w = w.slice(0, -2); step1bExtra = true
  } else if (w.endsWith('ing') && hasVowel(w.slice(0, -3))) {
    w = w.slice(0, -3); step1bExtra = true
  }
  if (step1bExtra) {
    if (w.endsWith('at') || w.endsWith('bl') || w.endsWith('iz')) w += 'e'
    else if (endsDoubleCons(w) && !'lsz'.includes(w[w.length - 1])) w = w.slice(0, -1)
    else if (measure(w) === 1 && cvc(w)) w += 'e'
  }
  // Step 1c
  if (w.endsWith('y') && hasVowel(w.slice(0, -1))) w = w.slice(0, -1) + 'i'
  // Step 2
  const step2 = [['ational', 'ate'], ['tional', 'tion'], ['enci', 'ence'], ['anci', 'ance'], ['izer', 'ize'],
    ['abli', 'able'], ['alli', 'al'], ['entli', 'ent'], ['eli', 'e'], ['ousli', 'ous'], ['ization', 'ize'],
    ['ation', 'ate'], ['ator', 'ate'], ['alism', 'al'], ['iveness', 'ive'], ['fulness', 'ful'], ['ousness', 'ous'],
    ['aliti', 'al'], ['iviti', 'ive'], ['biliti', 'ble']]
  for (const [suf, rep] of step2) {
    if (w.endsWith(suf)) { w = replace(w, suf, rep, 0); break }
  }
  // Step 3
  const step3 = [['icate', 'ic'], ['ative', ''], ['alize', 'al'], ['iciti', 'ic'], ['ical', 'ic'], ['ful', ''], ['ness', '']]
  for (const [suf, rep] of step3) {
    if (w.endsWith(suf)) { w = replace(w, suf, rep, 0); break }
  }
  // Step 4
  const step4 = ['al', 'ance', 'ence', 'er', 'ic', 'able', 'ible', 'ant', 'ement', 'ment', 'ent', 'ion', 'ou',
    'ism', 'ate', 'iti', 'ous', 'ive', 'ize']
  for (const suf of step4.sort((a, b) => b.length - a.length)) {
    if (!w.endsWith(suf)) continue
    const stem = w.slice(0, -suf.length)
    if (measure(stem) > 1 && (suf !== 'ion' || /[st]$/.test(stem))) w = stem
    break
  }
  // Step 5
  if (w.endsWith('e')) {
    const stem = w.slice(0, -1)
    const m = measure(stem)
    if (m > 1 || (m === 1 && !cvc(stem))) w = stem
  }
  if (measure(w) > 1 && endsDoubleCons(w) && w.endsWith('l')) w = w.slice(0, -1)
  return w
}

function mwKeywordTerms(text) {
  const words = String(text || '').slice(0, 20000).toLowerCase().split(/[^\p{L}\p{N}]+/u)
  const out = []
  for (const word of words) {
    if (!word || MW_STOPWORDS.has(word)) continue
    const term = /^[a-z]+$/.test(word) ? mwPorterStem(word) : word
    if (term.length >= 2) out.push(term)
  }
  return out
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    MW_CHUNK_CANDIDATES,
    MW_SNIPPET_CHARS,
    MW_EXCERPT_CHARS,
    MW_EXCERPT_GAP,
    MW_MIN_SIMILARITY,
    MW_MAX_GAP_FROM_TOP,
    MW_ABOUT_ME_MIN_SIMILARITY,
    MW_ABOUT_ME_PER_QUERY,
    MW_KEYWORD_CANDIDATES,
    mwGroupChunkHits,
    mwGroupKeywordHits,
    mwApplyRelevanceCutoff,
    mwMergeHybrid,
    mwBuildExcerpt,
    mwPorterStem,
    mwKeywordTerms
  }
}
