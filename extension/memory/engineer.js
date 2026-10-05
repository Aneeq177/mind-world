/* The Improve pipeline after retrieval, for local mode with the user's own
 * Anthropic key. Port of backend/services/engineer_core.py and the LLM calls
 * in personalization_llm.py, driven by the same prompts.json (fetched from
 * GET /engineer_prompts) so prompts match the server's. Requires scoring.js
 * and retrieval.js. Deterministic parts are checked by tests/js fixtures.
 */

const MW_ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const MW_PROFILE_ROUTE_FACTS = 10
const MW_DEFAULT_FACTS = 6
const MW_RERANK_LIMIT = 5

function mwPromptText(value) {
  return Array.isArray(value) ? value.join('\n') : String(value ?? '')
}

function mwRender(template, values = {}) {
  let out = mwPromptText(template)
  for (const [name, value] of Object.entries(values)) out = out.split(`{{${name}}}`).join(String(value))
  return out
}

function mwPromptSystem(prompts, name, values = {}) {
  const entry = prompts[name]
  return { system: mwRender(entry.system, values), maxTokens: Math.trunc(Number(entry.max_tokens || 600)) }
}

/* json.dumps(obj, ensure_ascii=False): same separators as Python so prompt text matches. */
function mwPyJson(value) {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'null'
  if (typeof value === 'string') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(mwPyJson).join(', ')}]`
  return `{${Object.entries(value).filter(([, v]) => v !== undefined).map(([k, v]) => `${JSON.stringify(k)}: ${mwPyJson(v)}`).join(', ')}}`
}

function mwAdaptationHint(prompts, adaptive) {
  const hints = prompts.adaptation_hints
  const a = adaptive || {}
  const concise = Number(a.concise_bias || 0.5) || 0.5
  const detail = Number(a.detail_level || 0.5) || 0.5
  if (concise >= 0.62) return hints.concise
  if (detail >= 0.65) return hints.detail
  return hints.balanced
}

function mwPyRound1(x) {
  return Math.round(x * 10) / 10
}

/* { sourcesUsed, contextParts } like build_conversation_context. */
function mwBuildConversationContext(prompts, selected) {
  const tmpl = prompts.engineer_user.conversation_block
  const sourcesUsed = []
  const contextParts = []
  for (const conv of selected) {
    const fullText = conv.full_text || conv.preview || ''
    const excerpt = conv.excerpt || (fullText ? mwBuildExcerpt(fullText, conv.matched) : '')
    const sim = conv.similarity
    sourcesUsed.push({
      id: conv.id ?? null,
      title: conv.title || 'Untitled',
      preview: (conv.preview || fullText.slice(0, 120) || excerpt.slice(0, 120) || '').slice(0, 120),
      source: conv.source_app || conv.source || 'unknown',
      created_at: String(conv.created_at || '').slice(0, 10),
      similarity: sim !== null && sim !== undefined ? mwPyRound1(Number(sim) * 100) : null
    })
    if (excerpt) {
      contextParts.push(mwRender(tmpl, {
        title: conv.title ?? 'Untitled',
        date: String(conv.created_at ?? '').slice(0, 10),
        num_messages: conv.num_messages ?? 0,
        excerpt
      }))
    }
  }
  return { sourcesUsed, contextParts }
}

/* { context, adaptive } like build_profile_context. pickFacts(maxFacts) is
 * the LLM fact picker, used only when pickedFacts is null. */
async function mwBuildProfileContext(prompts, profile, draft, pickedFacts, { pickFacts, now } = {}) {
  const headers = prompts.engineer_user
  const p = profile || {}
  const profileData = p.profile_data || {}
  let context = ''
  let adaptive = {}
  const confirmed = mwExtractConfirmedAnchorFacts(profileData, { now })
  if (confirmed.length) context = headers.anchors_header + confirmed.map((f) => `- ${f}\n`).join('') + '\n'
  if (p.is_profile_enabled) {
    adaptive = mwNormalizeProfileData(profileData).adaptive_weights || {}
    let facts = pickedFacts
    if (facts === null || facts === undefined) facts = pickFacts ? await pickFacts(MW_DEFAULT_FACTS) : []
    if (!facts || !facts.length) facts = mwExtractRelevantProfileFacts(profileData, draft, 0.62, MW_DEFAULT_FACTS, { now })
    if (facts.length) context += headers.profile_header + facts.map((f) => `- ${f}\n`).join('') + '\n'
  }
  return { context, adaptive }
}

function mwBuildEngineerMessages(prompts, draft, contextParts, profileContext, adaptive, templateName = '', templateBody = '', skipMemory = false) {
  const userTmpl = prompts.engineer_user
  const { system, maxTokens } = skipMemory && templateName
    ? mwPromptSystem(prompts, 'engineer_template_merge', { core_role: mwPromptText(prompts.engineer_core_role) })
    : mwPromptSystem(prompts, 'engineer_v3', { adaptation_hint: mwAdaptationHint(prompts, adaptive) })
  const convContext = contextParts.length ? contextParts.join(userTmpl.conversation_separator) : ''
  let user = `${userTmpl.draft_header}${draft}\n${profileContext}`
  if (convContext.trim()) user += userTmpl.history_header + convContext
  if (templateBody) user += mwRender(userTmpl.template_header, { template_name: templateName }) + templateBody
  else if (templateName) user += mwRender(userTmpl.template_hint, { template_name: templateName })
  return { system, user, maxTokens }
}

/* Port of prompt_format.format_engineered_prompt. */
function mwFormatEngineeredPrompt(text) {
  if (!text || !text.trim()) return text || ''
  let s = text.trim()
  s = s.replace(/\n*-{3,}\n*/g, '\n\n')
  s = s.replace(/^-{3,}\s*/, '')
  s = s.replace(/\s*-{3,}\s*$/, '')
  s = s.replace(/\*\*([^*]+)\*\*/g, '$1')
  s = s.replace(/[ \t]+/g, ' ')
  s = s.replace(/ *\n */g, '\n')
  s = s.replace(/\n{3,}/g, '\n\n')
  return s.trim()
}

/* ---- Anthropic calls (user's own key) ----------------------------------- */

class MwAnthropicError extends Error {
  constructor(message, status) { super(message); this.status = status }
}

async function mwAnthropic(apiKey, model, system, user, maxTokens) {
  const res = await fetch(MW_ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] })
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    const detail = (body && body.error && body.error.message) || `Anthropic request failed (${res.status})`
    if (res.status === 401) throw new MwAnthropicError('Your Anthropic API key was rejected. Check it in Mind World settings.', 401)
    if (res.status === 429) throw new MwAnthropicError('Your Anthropic account is rate limited or out of credits.', 429)
    throw new MwAnthropicError(detail, res.status)
  }
  const data = await res.json()
  const block = (data.content || []).find((b) => b.type === 'text')
  return String((block && block.text) || '').trim()
}

class MwByokLLM {
  constructor(prompts, apiKey) {
    this.prompts = prompts
    this.apiKey = apiKey
    this.model = prompts.model
  }

  async call(name, values, user) {
    const { system, maxTokens } = mwPromptSystem(this.prompts, name, values)
    return mwAnthropic(this.apiKey, this.model, system, user, maxTokens)
  }

  async rerank(draft, candidates, limit = MW_RERANK_LIMIT) {
    if (!candidates.length) return candidates.slice(0, limit)
    const compact = candidates.slice(0, 15).filter((c) => c.id).map((c) => ({
      id: c.id,
      title: c.title ?? '',
      preview: (c.snippet || '').slice(0, 600) || (c.preview || '').slice(0, 180),
      similarity: c.similarity ?? null
    }))
    if (!compact.length) return candidates.slice(0, limit)
    try {
      const raw = await this.call('rerank', { limit }, `DRAFT:\n${draft.slice(0, 1500)}\n\nCANDIDATES:\n${mwPyJson(compact)}`)
      const payload = mwParseJsonText(raw)
      const ids = payload && !Array.isArray(payload) ? payload.ranked_ids : null
      if (!Array.isArray(ids)) return candidates.slice(0, limit)
      const byId = new Map(candidates.map((c) => [c.id, c]))
      const out = []
      for (const id of ids) if (byId.has(id) && !out.includes(byId.get(id))) out.push(byId.get(id))
      if (ids.length && !out.length) return candidates.slice(0, limit)
      return out.slice(0, limit)
    } catch (err) {
      if (err instanceof MwAnthropicError && err.status === 401) throw err
      return candidates.slice(0, limit)
    }
  }

  async pickFacts(profileData, draft, maxFacts = MW_DEFAULT_FACTS) {
    if (!String(draft || '').trim()) return []
    const profile = mwNormalizeProfileData(profileData)
    try {
      const raw = await this.call('pick_facts', { max_facts: maxFacts },
        `USER DRAFT:\n${draft.slice(0, 1500)}\n\nPROFILE:\n${mwPyJson(profile).slice(0, 4000)}`)
      const payload = mwParseJsonText(raw)
      const facts = payload && !Array.isArray(payload) ? payload.facts : payload
      if (Array.isArray(facts)) return facts.map((f) => String(f).trim()).filter(Boolean).slice(0, maxFacts)
    } catch (err) {
      if (err instanceof MwAnthropicError && err.status === 401) throw err
    }
    return []
  }

  async rewriteAboutMe(draft, maxQueries = 4) {
    if (!String(draft || '').trim()) return []
    try {
      const raw = await this.call('rewrite_about_me', { max_queries: maxQueries }, `DRAFT:\n${draft.slice(0, 1500)}`)
      const payload = mwParseJsonText(raw)
      const queries = payload && !Array.isArray(payload) ? payload.queries : payload
      if (Array.isArray(queries)) return queries.map((q) => String(q).trim().slice(0, 200)).filter(Boolean).slice(0, maxQueries)
    } catch (err) {
      if (err instanceof MwAnthropicError && err.status === 401) throw err
    }
    return []
  }

  /* [selected, facts | null] like select_memory. */
  async selectMemory(draft, candidates, profile, route = 'standard') {
    const p = profile || {}
    const factsPromise = p.is_profile_enabled
      ? this.pickFacts(p.profile_data || {}, draft, route === 'profile' ? MW_PROFILE_ROUTE_FACTS : MW_DEFAULT_FACTS)
      : Promise.resolve(null)
    return Promise.all([this.rerank(draft, candidates, MW_RERANK_LIMIT), factsPromise])
  }

  async engineer(system, user, maxTokens) {
    return mwFormatEngineeredPrompt(await mwAnthropic(this.apiKey, this.model, system, user, maxTokens))
  }

  /* infer_profile_delta_llm: batches snippets; heuristic fallback on failure. */
  async inferProfileDelta(profileData, conversationText, { force = false } = {}) {
    const profile = mwQueueSnippetForLlmExtraction(profileData, conversationText)
    if (!force && !mwShouldRunLlmExtraction(profile)) return profile
    const pending = profile.llm_pending_snippets || []
    const combined = pending.slice(-3).join('\n\n---\n\n').slice(0, 6000)
    try {
      const raw = await this.call('profile_extract', {},
        `EXISTING PROFILE:\n${mwPyJson(mwNormalizeProfileData(profile)).slice(0, 3000)}\n\nNEW CONVERSATION SNIPPET(S):\n${combined}`)
      const delta = mwParseJsonText(raw)
      if (delta && typeof delta === 'object' && !Array.isArray(delta)) {
        const merged = mwMergeLlmProfileDelta(profile, delta)
        merged.llm_pending_snippets = []
        merged.profile_version = Math.trunc(Number(profile.profile_version || 0)) + 1
        return merged
      }
    } catch (_) {}
    const merged = mwInferProfileDelta(profile, combined || conversationText)
    merged.llm_pending_snippets = []
    return merged
  }

  async synthesizeProfile(profileData, samples) {
    const profile = mwNormalizeProfileData(profileData)
    if (!samples || !samples.length) return profile
    const compact = samples.slice(0, 25).map((s) => ({
      title: s.title ?? '',
      preview: String(s.preview || '').slice(0, 200),
      source: s.source_app || s.source || ''
    }))
    try {
      const raw = await this.call('profile_synthesize', {},
        `CURRENT PROFILE:\n${mwPyJson(profile).slice(0, 3500)}\n\nRECENT CONVERSATIONS:\n${mwPyJson(compact)}`)
      const payload = mwParseJsonText(raw)
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return profile
      const merged = mwMergeLlmProfileDelta(profile, payload)
      const summary = String(payload.inferred_summary || '').trim()
      if (summary) {
        merged.llm_synthesized_summary = summary
        merged.llm_summary_confidence = Number(payload.summary_confidence || 0) || 0
      }
      const corrections = Array.isArray(payload.quick_corrections) ? payload.quick_corrections : []
      if (corrections.length) {
        merged.llm_quick_corrections = corrections
          .map((c, i) => ({ c, i }))
          .filter(({ c }) => c && typeof c === 'object' && c.label)
          .map(({ c, i }) => ({ id: String(c.id ?? `corr_${i}`), label: String(c.label).trim() }))
          .slice(0, 6)
      }
      merged.last_llm_synthesis_at = new Date().toISOString().replace('Z', '+00:00')
      merged.profile_version = Math.trunc(Number(profile.profile_version || 0)) + 1
      return merged
    } catch (_) {
      return profile
    }
  }

  async applyEditFeedback(profileData, diffMetrics, acceptedUnedited, engineered, final) {
    let updated = mwApplyEditFeedbackAdaptation(profileData, diffMetrics || {}, !!acceptedUnedited)
    if (!engineered || !final || engineered.trim() === final.trim()) return updated
    try {
      const raw = await this.call('profile_edit_feedback', {},
        `ENGINEERED:\n${engineered.slice(0, 2000)}\n\nUSER FINAL:\n${final.slice(0, 2000)}`)
      const payload = mwParseJsonText(raw)
      if (payload && !Array.isArray(payload) && payload.preferences) {
        updated = mwMergeLlmProfileDelta(updated, { preferences: payload.preferences })
      }
    } catch (_) {}
    return updated
  }

  async mergePopupProfile(profileData, popupFields) {
    const profile = mwNormalizeProfileData(profileData)
    const cleaned = {}
    for (const [k, v] of Object.entries(popupFields || {})) if (String(v ?? '').trim()) cleaned[k] = String(v).trim()
    if (!Object.keys(cleaned).length) return profile
    try {
      const raw = await this.call('profile_popup_merge', {},
        `EXISTING PROFILE:\n${mwPyJson(profile).slice(0, 2500)}\n\nUSER-PROVIDED FIELDS:\n${mwPyJson(cleaned)}`)
      const payload = mwParseJsonText(raw)
      if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
        const merged = { ...mwMergeLlmProfileDelta(profile, payload), ...cleaned }
        merged.last_popup_merge_at = new Date().toISOString().replace('Z', '+00:00')
        return merged
      }
    } catch (_) {}
    return { ...profile, ...cleaned }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    mwRender,
    mwPromptSystem,
    mwPyJson,
    mwAdaptationHint,
    mwBuildConversationContext,
    mwBuildProfileContext,
    mwBuildEngineerMessages,
    mwFormatEngineeredPrompt,
    MwByokLLM,
    MwAnthropicError
  }
}
