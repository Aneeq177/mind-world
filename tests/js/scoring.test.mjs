import { test } from 'node:test'
import { assertClose, golden, loadExtension } from './helpers.mjs'

const S = loadExtension('memory/scoring.js')
const G = golden.scoring
const now = G.now_ms
const P = G.profiles

test('normalize_profile_data', () => {
  const inputs = [...P, '{"domains": {}}', '[]', 5]
  inputs.forEach((p, i) => assertClose(S.mwNormalizeProfileData(p), G.normalize[i], `normalize ${i}`))
})

test('infer_profile_delta', () => {
  G.infer_delta.forEach((c, i) => assertClose(S.mwInferProfileDelta(P[c.profile], c.snippet, { now }), c.out, `delta ${i}`))
})

test('decay_confidence', () => {
  G.decay.forEach((c, i) => assertClose(S.mwDecayConfidence(c.conf, c.ts, { now }), c.out, `decay ${i}`))
})

test('per-profile summaries, facts and gates', () => {
  P.forEach((p, i) => {
    const e = G.per_profile[i]
    const at = (k) => `profile ${i} ${k}`
    assertClose(S.mwGetTopDomains(p, undefined, undefined, { now }), e.top_domains, at('top_domains'))
    assertClose(S.mwGetTopDomains(p, 0.25, 4, { now }), e.top_domains_loose, at('top_domains_loose'))
    assertClose(S.mwComputeSummaryConfidence(p, { now }), e.summary_confidence, at('summary_confidence'))
    assertClose(S.mwBuildInferredSummary(p, { now }), e.inferred_summary, at('inferred_summary'))
    assertClose(S.mwProfileHasPersonalFacts(p), e.personal_facts, at('personal_facts'))
    assertClose(S.mwHasEnoughHistory(10, p, { now }), e.enough_history_10, at('enough_history_10'))
    assertClose(S.mwHasEnoughHistory(3, p, { now }), e.enough_history_3, at('enough_history_3'))
    assertClose(S.mwShouldPromptConfirmation(p, { now }), e.prompt_confirmation, at('prompt_confirmation'))
    assertClose(S.mwExtractConfirmedAnchorFacts(p, { now }), e.anchor_facts, at('anchor_facts'))
    assertClose(S.mwGetDisplaySummary(p, { now }), e.display_summary, at('display_summary'))
    assertClose(S.mwGetQuickCorrections(p), e.quick_corrections, at('quick_corrections'))
    assertClose(S.mwSynthesisIsStale(p, { now }), e.synthesis_stale, at('synthesis_stale'))
    assertClose(S.mwShouldRunLlmExtraction(p), e.should_extract, at('should_extract'))
    const queries = ['fix my python api debug error', 'write a cover letter for an internship',
      'help with the mind world landing page', 'make my essay more formal', '']
    queries.forEach((q, j) => assertClose(
      S.mwExtractRelevantProfileFacts(p, q, undefined, undefined, { now }), e.relevant_facts[j], at(`relevant_facts ${j}`)))
  })
})

test('apply_summary_confirmation', () => {
  G.confirmation.forEach((c, i) => assertClose(S.mwApplySummaryConfirmation(P[c.profile], c.action, c.ids, { now }), c.out, `confirm ${i}`))
})

test('hybrid_score_conversations', () => {
  G.hybrid.forEach((c, i) => assertClose(S.mwHybridScoreConversations(c.convs, c.query, P[c.profile], { now }), c.out, `hybrid ${i}`))
})

test('apply_edit_feedback_adaptation', () => {
  G.edit_feedback.forEach((c, i) => assertClose(S.mwApplyEditFeedbackAdaptation(P[c.profile], c.metrics, c.accepted, { now }), c.out, `feedback ${i}`))
})

test('merge_llm_profile_delta', () => {
  G.merge_delta.forEach((c, i) => assertClose(S.mwMergeLlmProfileDelta(P[c.profile], c.delta, { now }), c.out, `merge ${i}`))
})

test('queue_snippet_for_llm_extraction', () => {
  G.queue.forEach((c, i) => assertClose(S.mwQueueSnippetForLlmExtraction(c.profile, c.snippet), c.out, `queue ${i}`))
})

test('is_about_me', () => {
  G.about_me.forEach((c) => assertClose(S.mwIsAboutMe(c.draft), c.out, `about_me ${JSON.stringify(c.draft)}`))
})

test('memory_route', () => {
  G.route.forEach((c, i) => assertClose(S.mwMemoryRoute(c.draft, c.profile), c.out, `route ${i}`))
})

test('parse_json_text', () => {
  G.parse_json.forEach((c, i) => assertClose(S.mwParseJsonText(c.text), c.out, `parse ${i}`))
})
