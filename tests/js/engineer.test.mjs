import { test } from 'node:test'
import { assertClose, golden, loadExtension } from './helpers.mjs'

// engineer.js is a classic script that relies on scoring.js and retrieval.js globals.
Object.assign(globalThis, loadExtension('memory/scoring.js'), loadExtension('memory/retrieval.js'))
const E = loadExtension('memory/engineer.js')
const G = golden.engineer
const now = golden.scoring.now_ms
const P = golden.scoring.profiles

test('build_conversation_context', () => {
  G.contexts.forEach((c, i) => {
    const { sourcesUsed, contextParts } = E.mwBuildConversationContext(G.prompts, c.selected)
    assertClose([sourcesUsed, contextParts], c.out, `context ${i}`)
  })
})

test('build_profile_context with picked facts', async () => {
  for (const [i, c] of G.profile_contexts.entries()) {
    const profile = { is_profile_enabled: c.enabled, profile_data: P[c.profile] }
    const out = await E.mwBuildProfileContext(G.prompts, profile, 'fix my python api debug error', c.facts, { now })
    assertClose(out.context, c.context, `profile context ${i}`)
    assertClose(out.adaptive, c.adaptive, `adaptive ${i}`)
  }
})

test('build_engineer_messages', () => {
  G.messages.forEach((c, i) => {
    const out = E.mwBuildEngineerMessages(G.prompts, 'fix my bug', c.parts, '\n[X]\n- a\n\n', c.adaptive, c.template_name, c.template_body, c.skip)
    assertClose([out.system, out.user, out.maxTokens], [c.system, c.user, c.max_tokens], `messages ${i}`)
  })
})

test('format_engineered_prompt', () => {
  G.formats.forEach((c, i) => assertClose(E.mwFormatEngineeredPrompt(c.text), c.out, `format ${i}`))
})
