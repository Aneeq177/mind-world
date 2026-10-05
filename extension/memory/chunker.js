/* Split conversation text into overlapping chunks for retrieval.
 * Port of backend/services/chunker.py (checked by tests/js golden fixtures).
 *
 * Spans are UTF-16 offsets into full_text; they are only ever used against the
 * same JS string, so they stay consistent on-device.
 */

// all-MiniLM-L6-v2 reads at most 256 word pieces (~1,000 chars of English).
const MW_CHUNK_SIZE = 800
const MW_CHUNK_OVERLAP = 150
// A tail shorter than this is folded into the previous chunk.
const MW_MIN_TAIL = 200

// Preferred break points, best first, as [separator, cut offset into separator].
// "\n\n[" starts a new "[role] ..." message, so cut before it.
const MW_BREAKS = [
  ['\n\n[', 0],
  ['\n\n', 2],
  ['\n', 1],
  ['. ', 2],
  ['? ', 2],
  ['! ', 2],
  [' ', 1]
]

function mwIsSpace(ch) {
  return /\s/.test(ch)
}

/* Last separator occurrence fully inside [lo, hi), like Python str.rfind(sep, lo, hi). */
function mwBestBreak(text, lo, hi) {
  for (const [sep, offset] of MW_BREAKS) {
    const from = hi - sep.length
    if (from < lo) continue
    const idx = text.lastIndexOf(sep, from)
    if (idx !== -1 && idx >= lo) return idx + offset
  }
  return hi
}

/* Move a chunk start forward to the next word so chunks don't open mid-word. */
function mwAlignStart(text, start, limit) {
  if (start === 0 || mwIsSpace(text[start - 1])) return start
  let idx = start
  while (idx < limit && !mwIsSpace(text[idx])) idx++
  while (idx < limit && mwIsSpace(text[idx])) idx++
  return idx < limit ? idx : start
}

function mwChunkSpans(text, size = MW_CHUNK_SIZE, overlap = MW_CHUNK_OVERLAP) {
  const s = text || ''
  const n = s.length
  if (n === 0) return []
  if (n <= size + MW_MIN_TAIL) return [[0, n]]

  const spans = []
  let start = 0
  while (start < n) {
    if (n - start <= size + MW_MIN_TAIL) {
      spans.push([start, n])
      break
    }
    const end = mwBestBreak(s, start + Math.floor(size / 2), start + size)
    spans.push([start, end])
    const nextStart = mwAlignStart(s, Math.max(end - overlap, start + 1), end)
    start = nextStart > start ? nextStart : end
  }
  return spans
}

/* Every chunk carries the title so a mid-conversation chunk keeps its topic. */
function mwChunkEmbedInputs(title, text, spans) {
  const head = String(title || 'Untitled').trim()
  return spans.map(([s, e]) => `${head}. ${text.slice(s, e)}`)
}

async function mwTextHash(text) {
  const bytes = new TextEncoder().encode(text || '')
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    MW_CHUNK_SIZE,
    MW_CHUNK_OVERLAP,
    MW_MIN_TAIL,
    mwChunkSpans,
    mwChunkEmbedInputs,
    mwTextHash
  }
}
