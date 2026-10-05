import assert from 'node:assert/strict'
import { test } from 'node:test'
import { assertClose, golden, loadExtension } from './helpers.mjs'

const R = loadExtension('memory/retrieval.js')
const G = golden.retrieval

test('group_chunk_hits', () => {
  G.group.forEach((c, i) => assertClose(R.mwGroupChunkHits(c.hits), c.out, `group ${i}`))
})

test('apply_relevance_cutoff', () => {
  G.cutoff.forEach((c, i) => assertClose(R.mwApplyRelevanceCutoff(c.cands, ...c.args), c.out, `cutoff ${i}`))
})

test('build_excerpt', () => {
  G.excerpt.forEach((c, i) => assertClose(R.mwBuildExcerpt(G.text, c.matched, c.budget), c.out, `excerpt ${i}`))
})

test('group_keyword_hits', () => {
  G.keyword_group.forEach((c, i) => assertClose(R.mwGroupKeywordHits(c.hits), c.out, `keyword ${i}`))
})

test('merge_hybrid', () => {
  G.hybrid.forEach((c, i) => {
    const out = R.mwMergeHybrid(c.vec, c.kw, { minSimilarity: c.min_similarity, perListCap: c.cap })
    assertClose(out, c.out, `hybrid ${i}`)
  })
})

test('keyword terms stem, drop stopwords and keep non-ASCII words', () => {
  assert.deepEqual(R.mwKeywordTerms('The running dogs are connected'), ['run', 'dog', 'connect'])
  assert.deepEqual(R.mwKeywordTerms('Internships in New York'), ['internship', 'new', 'york'])
  assert.deepEqual(R.mwKeywordTerms('café résumé a'), ['café', 'résumé'])
  assert.equal(R.mwPorterStem('relational'), 'relat')
  assert.equal(R.mwPorterStem('generalization'), 'gener')
  assert.equal(R.mwPorterStem('hopping'), 'hop')
  assert.equal(R.mwPorterStem('caresses'), 'caress')
})
