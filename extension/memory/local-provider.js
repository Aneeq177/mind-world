/* On-device memory. Conversations, chunks, vectors, and the profile stay in
 * IndexedDB; search runs in the offscreen engine. Improve sends only the
 * matched excerpts for one call, either to the stateless relay
 * (/engineer_prompt_stateless, server key and quota) or straight to Anthropic
 * with the user's own key.
 *
 * Requires schema, chunker, retrieval, scoring, engineer, local-db,
 * engine-client, cloud-provider (MW_CLIENT_HEADER), and background.js helpers
 * (API_BASE, getAuthContext, isMemoryEnabled, formatApiErrorDetail,
 * handleGetTemplates).
 */

const MW_PROMPTS_CACHE_KEY = 'mw_engineer_prompts'
const MW_PROMPTS_TTL_MS = 6 * 60 * 60 * 1000
// The relay rejects profiles over 20k characters of JSON.
const MW_RELAY_PROFILE_CHARS = 18_000
const MW_IMPORT_BATCH = 16
// Same threshold /personalization_summary uses before synthesizing a profile.
const MW_MIN_HISTORY_FOR_SYNTHESIS = 8
const MW_MANUAL_PROFILE_KEYS = ['background', 'situation', 'goals', 'constraints', 'preferences']

async function mwGetEngineerPrompts() {
  const cached = (await chrome.storage.local.get(MW_PROMPTS_CACHE_KEY))[MW_PROMPTS_CACHE_KEY]
  if (cached && Date.now() - cached.fetched_at < MW_PROMPTS_TTL_MS) return cached.prompts
  try {
    const res = await fetch(`${API_BASE}/engineer_prompts`)
    if (res.ok) {
      const prompts = await res.json()
      await chrome.storage.local.set({ [MW_PROMPTS_CACHE_KEY]: { prompts, fetched_at: Date.now() } })
      return prompts
    }
  } catch (_) {}
  if (cached) return cached.prompts
  throw new Error('Could not load Improve prompts. Check your connection and try again.')
}

/* The user's Anthropic key when local Improve should call Anthropic directly. */
async function mwGetByokKey() {
  const s = await chrome.storage.local.get(['mw_api_key', 'mw_byok_direct'])
  const key = String(s.mw_api_key || '').trim()
  return key.startsWith('sk-ant-') && s.mw_byok_direct !== false ? key : null
}

/* profile_data small enough for the relay: drop queued snippets (oldest
 * first), then bulky optional fields. */
function mwFitProfileData(profileData, limit = MW_RELAY_PROFILE_CHARS) {
  const data = { ...mwNormalizeProfileData(profileData) }
  const size = () => JSON.stringify(data).length
  while (size() > limit && data.llm_pending_snippets.length) data.llm_pending_snippets = data.llm_pending_snippets.slice(1)
  for (const key of ['quality_metrics', 'llm_quick_corrections', 'entities', 'constraints', 'active_projects']) {
    if (size() <= limit) break
    delete data[key]
  }
  if (size() > limit) {
    const slim = { confirmed_anchors: data.confirmed_anchors, adaptive_weights: data.adaptive_weights }
    for (const k of MW_MANUAL_PROFILE_KEYS) if (typeof data[k] === 'string') slim[k] = data[k].slice(0, 2000)
    return slim
  }
  return data
}

async function mwRelay(path, body) {
  const auth = await getAuthContext()
  if (auth.error) throw new Error(auth.error)
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-MW-Client': MW_CLIENT_HEADER },
    body: JSON.stringify({ email: auth.email, access_token: auth.accessToken, ...body })
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(formatApiErrorDetail(err) || `Request failed (${res.status})`)
  }
  return res.json()
}

/* Profile LLM operations through the user's key or the relay. Each falls
 * back to the on-device heuristic when the call fails. */
async function mwProfileOps() {
  const key = await mwGetByokKey()
  if (key) {
    const llm = new MwByokLLM(await mwGetEngineerPrompts(), key)
    return {
      extract: (pd, snippet) => llm.inferProfileDelta(pd, snippet),
      synthesize: (pd, samples) => llm.synthesizeProfile(pd, samples),
      editFeedback: (pd, m, accepted, eng, fin) => llm.applyEditFeedback(pd, m, accepted, eng, fin),
      popupMerge: (pd, fields) => llm.mergePopupProfile(pd, fields)
    }
  }
  const infer = async (op, body) => (await mwRelay('/profile/infer_stateless', { op, ...body })).profile_data
  return {
    extract: (pd, snippet) => infer('extract', { profile_data: mwFitProfileData(pd), snippet })
      .catch(() => {
        const merged = mwInferProfileDelta(mwQueueSnippetForLlmExtraction(pd, snippet), snippet)
        merged.llm_pending_snippets = []
        return merged
      }),
    synthesize: (pd, samples) => infer('synthesize', {
      profile_data: mwFitProfileData(pd),
      samples: samples.map((s) => ({ title: s.title, preview: s.preview, source_app: s.source_app }))
    }).catch(() => pd),
    editFeedback: (pd, m, accepted, eng, fin) => infer('edit_feedback', {
      profile_data: mwFitProfileData(pd), diff_metrics: m, accepted_unedited: accepted, engineered_prompt: eng, final_prompt: fin
    }).catch(() => mwApplyEditFeedbackAdaptation(pd, m, accepted)),
    popupMerge: (pd, fields) => infer('popup_merge', { profile_data: mwFitProfileData(pd), popup_fields: fields })
      .catch(() => ({ ...mwNormalizeProfileData(pd), ...fields }))
  }
}

function mwNormalizeImportedConversation(c) {
  const fullText = String(c.full_text || '')
  return {
    id: String(c.id),
    title: c.title || 'Untitled',
    source_app: c.source_app || c.source || 'claude',
    created_at: c.created_at || '',
    updated_at: c.updated_at || c.created_at || '',
    num_messages: Math.trunc(Number(c.num_messages) || 0),
    char_count: fullText.length,
    preview: c.preview || fullText.slice(0, MW_PREVIEW_CHARS),
    full_text: fullText
  }
}

class MwLocalProvider {
  constructor() {
    this._profileChain = Promise.resolve()
  }

  /* Serialize read-modify-write profile updates (saves and feedback overlap). */
  _updateProfile(fn) {
    const run = this._profileChain.then(async () => {
      const profile = await MwLocalDB.getProfile()
      const next = await fn(profile)
      if (next) await MwLocalDB.putProfile({ profile_data: next })
      return next
    })
    this._profileChain = run.catch(() => {})
    return run
  }

  async saveConversation(item) {
    const conv = mwConversationFromQueueItem(item)
    if (conv.full_text.trim().length < 10) return { saved: false, reason: 'too_short' }
    if (!conv.id) return { saved: false, reason: 'no_id' }
    const existing = await MwLocalDB.getConversation(conv.id)
    if (existing && existing.created_at) conv.created_at = existing.created_at
    await MwEngine.index([conv])
    this._inferFromConversation(conv.full_text.slice(0, 2500)).catch(() => {})
    return { saved: true, id: conv.id }
  }

  async _inferFromConversation(snippet) {
    const profile = await MwLocalDB.getProfile()
    if (!profile.is_profile_enabled) return
    await this._updateProfile(async (p) => {
      const queued = mwQueueSnippetForLlmExtraction(p.profile_data, snippet)
      if (!mwShouldRunLlmExtraction(queued)) return queued
      const ops = await mwProfileOps()
      return ops.extract(p.profile_data, snippet)
    })
  }

  /* One import batch (MW_LOCAL_IMPORT_BATCH): skip conversations whose stored
   * copy has more messages, index the rest. */
  async importConversations(batch) {
    const convs = (batch || []).filter((c) => c && c.id).map(mwNormalizeImportedConversation)
    const newer = await MwLocalDB.idsWithNewerStoredCopy(convs)
    const toIndex = convs.filter((c) => !newer.has(c.id))
    const result = toIndex.length ? await MwEngine.index(toIndex) : { indexed: 0, skipped: 0 }
    return { stored: toIndex.length, kept_newer: newer.size, ...result }
  }

  /* Candidates like retrieve_candidates_multi: chunk hits per query, grouped
   * by conversation, fused, and enriched with the stored conversation. */
  async _retrieve(queries, { limit, minSimilarity = MW_MIN_SIMILARITY, useKeywords = true, perQueryCap = null }) {
    const withKeywords = queries.map((q) => useKeywords && !!String(q || '').trim())
    const results = await MwEngine.search(
      queries.map((text, i) => ({ text, keywords: withKeywords[i] })),
      { vectorK: MW_CHUNK_CANDIDATES, keywordK: MW_KEYWORD_CANDIDATES }
    )
    const ids = new Set()
    for (const r of results) for (const h of [...r.vector, ...r.keyword]) ids.add(h.conversation_id)
    const convs = new Map((await MwLocalDB.getConversations([...ids])).map((c) => [c.id, c]))
    const enrich = (h) => {
      const c = convs.get(h.conversation_id)
      if (!c) return null
      return {
        ...h,
        chunk_text: String(c.full_text || '').slice(h.start_char, h.end_char),
        title: c.title,
        preview: c.preview,
        created_at: c.created_at
      }
    }
    const vecLists = results.map((r) => mwGroupChunkHits(r.vector.map(enrich).filter(Boolean)))
    const kwLists = results
      .filter((_, i) => withKeywords[i])
      .map((r) => mwGroupKeywordHits(r.keyword.map(enrich).filter(Boolean)))
    if (!vecLists.some((l) => l.length)) return []
    const merged = mwMergeHybrid(vecLists, kwLists, { minSimilarity, perListCap: perQueryCap }).slice(0, limit)
    for (const m of merged) {
      const c = convs.get(m.id) || {}
      m.full_text = c.full_text || ''
      m.num_messages = c.num_messages || 0
      m.source_app = c.source_app || null
      m.updated_at = c.updated_at || null
    }
    return merged
  }

  async search(query, limit = 5) {
    const profile = await MwLocalDB.getProfile()
    let results
    if (profile.is_profile_enabled) {
      const candidates = await this._retrieve([query], { limit: Math.max(15, limit * 4) })
      results = mwHybridScoreConversations(candidates, query, profile.profile_data).slice(0, limit)
    } else {
      results = await this._retrieve([query], { limit })
    }
    return {
      results: results.map(({ matched, full_text, ...rest }) => rest)
    }
  }

  async _emptyMemoryStatus() {
    if (!(await MwLocalDB.countConversations())) return 'no_data'
    if (!(await MwLocalDB.countChunks())) return 'not_indexed'
    return 'no_match'
  }

  async _templateBody(name) {
    const { templates } = await handleGetTemplates()
    const t = (templates || []).find((x) => x.name === name)
    return (t && t.template) || ''
  }

  async engineerPrompt({ message, template, conversationIds, skipMemory, platform }) {
    const startedAt = Date.now()
    const byokKey = await mwGetByokKey()
    if (!byokKey) {
      const auth = await getAuthContext()
      if (auth.error) return { error: auth.error }
    }
    const skip = !!skipMemory || !(await isMemoryEnabled())
    const profile = await MwLocalDB.getProfile()
    const prompts = byokKey ? await mwGetEngineerPrompts() : null
    const llm = byokKey ? new MwByokLLM(prompts, byokKey) : null
    const pinned = !!(conversationIds && conversationIds.length)

    let route = 'standard'
    let candidates = []
    let memoryStatus = null
    let engineError = null
    if (!skip) {
      try {
        if (pinned) {
          candidates = (await MwLocalDB.getConversations(conversationIds)).map((c) => ({ ...c, matched: null }))
        } else {
          route = mwMemoryRoute(message, profile)
          const pool = profile.is_profile_enabled ? 20 : 15
          if (route === 'rewrite') {
            const rewrites = llm
              ? await llm.rewriteAboutMe(message)
              : await mwRelay('/rewrite_queries_stateless', { draft: message }).then((d) => d.queries || []).catch(() => [])
            candidates = await this._retrieve([message, ...rewrites], {
              limit: pool,
              minSimilarity: MW_ABOUT_ME_MIN_SIMILARITY,
              useKeywords: false,
              perQueryCap: MW_ABOUT_ME_PER_QUERY
            })
          } else {
            candidates = await this._retrieve([message], { limit: pool })
          }
          if (profile.is_profile_enabled) {
            candidates = mwHybridScoreConversations(candidates, message, profile.profile_data).slice(0, 15)
          }
        }
        if (!candidates.length) memoryStatus = await this._emptyMemoryStatus()
      } catch (err) {
        // Improve still runs, without memory; the status tells the user why.
        engineError = String((err && err.message) || err)
        candidates = []
      }
    }
    for (const c of candidates) c.excerpt = mwBuildExcerpt(c.full_text || '', c.matched)

    const templateName = template && template !== 'none' ? template : ''
    let data
    try {
      data = llm
        ? await this._engineerByok({ llm, prompts, message, candidates, profile, route, pinned, skip, templateName, memoryStatus })
        : await this._engineerRelay({ message, template, candidates, profile, route, pinned, skip, platform, memoryStatus })
    } catch (err) {
      return { error: String((err && err.message) || err) }
    }
    const memory = { ...(data.memory || {}), storage: 'local' }
    if (byokKey) memory.key = 'own'
    if (!data.conversations_used) memory.stored_conversations = await MwLocalDB.countConversations().catch(() => 0)
    if (engineError) {
      memory.status = 'unavailable'
      memory.error = engineError
    }
    return {
      engineeredPrompt: data.engineered_prompt,
      conversationsUsed: data.conversations_used || 0,
      sourcesUsed: data.sources_used || [],
      memory,
      latencyMs: Date.now() - startedAt
    }
  }

  async _engineerRelay({ message, template, candidates, profile, route, pinned, skip, platform, memoryStatus }) {
    const { mw_device_id: deviceId } = await chrome.storage.local.get('mw_device_id')
    return mwRelay('/engineer_prompt_stateless', {
      message,
      template: template || 'none',
      skip_memory: skip,
      device_id: deviceId || null,
      platform: platform || null,
      memory_route: route,
      memory_status: memoryStatus,
      pinned,
      candidates: candidates.slice(0, 15).map((c) => ({
        id: String(c.id),
        title: c.title || 'Untitled',
        snippet: String(c.snippet || '').slice(0, MW_SNIPPET_CHARS),
        excerpt: c.excerpt || '',
        preview: String(c.preview || '').slice(0, 300),
        created_at: c.created_at ? String(c.created_at) : null,
        source_app: c.source_app || null,
        num_messages: Math.trunc(Number(c.num_messages) || 0),
        similarity: typeof c.similarity === 'number' ? c.similarity : null,
        keyword_score: typeof c.keyword_score === 'number' ? c.keyword_score : null
      })),
      profile: { is_profile_enabled: !!profile.is_profile_enabled, profile_data: mwFitProfileData(profile.profile_data) }
    })
  }

  async _engineerByok({ llm, prompts, message, candidates, profile, route, pinned, skip, templateName, memoryStatus }) {
    let selected = []
    let facts = null
    if (!skip && candidates.length) {
      if (pinned) selected = candidates
      else [selected, facts] = await llm.selectMemory(message, candidates, profile, route)
    }
    const { sourcesUsed, contextParts } = mwBuildConversationContext(prompts, selected)
    let profileContext = ''
    let adaptive = {}
    if (!skip) {
      const built = await mwBuildProfileContext(prompts, profile, message, facts, {
        pickFacts: (n) => llm.pickFacts(profile.profile_data, message, n)
      })
      profileContext = built.context
      adaptive = built.adaptive
    }
    const templateBody = templateName ? await this._templateBody(templateName) : ''
    const { system, user, maxTokens } = mwBuildEngineerMessages(
      prompts, message, contextParts, profileContext, adaptive, templateName, templateBody, skip
    )
    const engineered = await llm.engineer(system, user, maxTokens)
    let memory
    if (skip) memory = { status: 'skipped' }
    else if (sourcesUsed.length) memory = { status: 'used' }
    else memory = { status: memoryStatus === 'no_data' || memoryStatus === 'not_indexed' ? memoryStatus : 'no_match', candidates: candidates.length }
    return { engineered_prompt: engineered, conversations_used: contextParts.length, sources_used: sourcesUsed, memory }
  }

  async getStats() {
    const summaries = await MwLocalDB.listConversationSummaries()
    const sources = [...new Set(summaries.map((c) => c.source_app).filter(Boolean))]
    return {
      conversationCount: summaries.length,
      platformCount: sources.length,
      sources,
      lastSavedAt: summaries[0] ? summaries[0].updated_at : null,
      chunkCount: await MwLocalDB.countChunks()
    }
  }

  async getPersonalizationSummary() {
    const count = await MwLocalDB.countConversations()
    let profileData = (await MwLocalDB.getProfile()).profile_data || {}
    if (count >= MW_MIN_HISTORY_FOR_SYNTHESIS && mwSynthesisIsStale(profileData)) {
      const samples = (await MwLocalDB.listConversationSummaries()).slice(0, 25)
      profileData = (await this._updateProfile(async (p) => {
        const ops = await mwProfileOps()
        return ops.synthesize(p.profile_data, samples)
      }).catch(() => null)) || profileData
    }
    const enough = mwHasEnoughHistory(count, profileData)
    return {
      hasEnoughHistory: enough,
      shouldShowConfirmation: enough && mwShouldPromptConfirmation(profileData),
      inferredSummary: mwGetDisplaySummary(profileData),
      summaryConfidence: mwComputeSummaryConfidence(profileData),
      conversationCount: count,
      quickCorrections: mwGetQuickCorrections(profileData),
      confirmedSummary: (mwNormalizeProfileData(profileData).confirmed_anchors || {}).summary || ''
    }
  }

  async confirmPersonalizationSummary(action, correctionIds) {
    const act = String(action || 'skip').trim().toLowerCase()
    if (act === 'shown') {
      const pd = mwNormalizeProfileData((await MwLocalDB.getProfile()).profile_data)
      return { success: true, confirmedSummary: pd.confirmed_anchors.summary || '' }
    }
    const updated = await this._updateProfile((p) => mwApplySummaryConfirmation(p.profile_data, act, correctionIds || []))
    return { success: true, confirmedSummary: (updated.confirmed_anchors || {}).summary || '' }
  }

  async getProfile() {
    const p = await MwLocalDB.getProfile()
    return { is_profile_enabled: !!p.is_profile_enabled, profile_data: p.profile_data || {} }
  }

  /* Mirrors /update_profile_settings: popup fields are merged into the
   * structured profile by the LLM; other fields are shallow-merged. */
  async updateProfile({ is_profile_enabled, profile_data }) {
    await MwLocalDB.putProfile({ is_profile_enabled: !!is_profile_enabled })
    if (profile_data) {
      await this._updateProfile(async (p) => {
        const existing = p.profile_data || {}
        const popupFields = {}
        for (const k of MW_MANUAL_PROFILE_KEYS) if (profile_data[k]) popupFields[k] = profile_data[k]
        if (!Object.keys(popupFields).length) return { ...existing, ...profile_data }
        const ops = await mwProfileOps().catch(() => null)
        return ops ? ops.popupMerge(existing, popupFields) : { ...existing, ...popupFields }
      })
    }
    return { success: true }
  }

  async clearInferredProfile() {
    await this._updateProfile((p) => {
      const data = p.profile_data || {}
      const kept = {}
      for (const k of ['background', 'situation', 'goals', 'constraints']) {
        if (typeof data[k] === 'string' && data[k].trim()) kept[k] = data[k]
      }
      if (typeof data.preferences === 'string' && data.preferences.trim()) kept.preferences = data.preferences
      return kept
    })
    return { success: true }
  }

  /* Keeps metrics only (no prompt text) and adapts the profile on edits. */
  async recordEditFeedback(message) {
    const eventType = String(message.eventType || 'rating').trim().toLowerCase()
    await MwLocalDB.addFeedback({
      rating: typeof message.rating === 'number' ? message.rating : 1,
      event_type: eventType,
      template_used: message.templateUsed || '',
      conversations_used: message.conversationsUsed || 0,
      goal_hash: message.goalHash || '',
      engineered_prompt_hash: message.engineeredPromptHash || '',
      final_prompt_hash: message.finalPromptHash || '',
      diff_metrics: message.diffMetrics || {},
      accepted_unedited: !!message.acceptedUnedited,
      edited: !!message.edited,
      latency_ms: message.latencyMs || null
    })
    if (eventType === 'edit_feedback') {
      const profile = await MwLocalDB.getProfile()
      if (profile.is_profile_enabled) {
        const engineered = String(message.engineeredPromptPreview || message.promptPreview || '').slice(0, 2500)
        const final = String(message.finalPromptPreview || '').slice(0, 2500)
        this._updateProfile(async (p) => {
          const ops = await mwProfileOps()
          return ops.editFeedback(p.profile_data, message.diffMetrics || {}, !!message.acceptedUnedited, engineered, final)
        }).catch(() => {})
      }
    }
    return { success: true }
  }

  async exportAll() {
    return MwLocalDB.exportAll()
  }

  /* A local backup or a cloud /export_data payload into on-device memory. */
  async importAll(json, { onProgress } = {}) {
    const conversations = ((json && json.conversations) || []).filter((c) => c && c.id && c.full_text)
    let imported = 0
    let keptNewer = 0
    for (let i = 0; i < conversations.length; i += MW_IMPORT_BATCH) {
      const res = await this.importConversations(conversations.slice(i, i + MW_IMPORT_BATCH))
      imported += res.stored
      keptNewer += res.kept_newer
      if (onProgress) onProgress({ done: Math.min(i + MW_IMPORT_BATCH, conversations.length), total: conversations.length })
    }
    const incoming = json && json.profile
    if (incoming && incoming.profile_data && Object.keys(incoming.profile_data).length) {
      const current = await MwLocalDB.getProfile()
      const currentEmpty = !Object.keys(mwNormalizeProfileData(current.profile_data)).some((k) => {
        const v = current.profile_data[k]
        return v && (typeof v !== 'object' || Object.keys(v).length)
      })
      if (currentEmpty) {
        await MwLocalDB.putProfile({
          is_profile_enabled: !!incoming.is_profile_enabled,
          profile_data: mwNormalizeProfileData(incoming.profile_data)
        })
      }
    }
    return { imported, skipped: conversations.length - imported - keptNewer, keptNewer }
  }

  async deleteAllMemory() {
    await MwLocalDB.deleteAll()
    return { deleted: true }
  }
}
