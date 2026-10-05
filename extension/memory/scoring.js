/* Personalization scoring and profile heuristics, plus "about me" routing.
 * Port of backend/services/personalization.py, the pure helpers of
 * personalization_llm.py, and query_intent.py (checked by tests/js golden
 * fixtures). Functions that depend on the clock take an optional `now`
 * (milliseconds) so tests are deterministic.
 */

const MW_MAX_SNIPPET_CHARS = 2000
const MW_MIN_DOMAIN_CONFIDENCE = 0.35
const MW_MIN_FACT_CONFIDENCE = 0.6
const MW_PROFILE_FACT_CAP = 6
const MW_STALE_HALF_LIFE_DAYS = 45.0
const MW_MIN_HISTORY_CONVERSATIONS = 8
const MW_MIN_SUMMARY_CONFIDENCE = 0.45
const MW_CONFIRMATION_STALE_DAYS = 30
const MW_SYNTHESIS_STALE_HOURS = 24
const MW_EXTRACTION_BATCH_SIZE = 3
const MW_DAY_MS = 86400000

const MW_DOMAIN_PATTERNS = {
  career: ['resume', 'cv', 'job', 'interview', 'application', 'linkedin', 'internship'],
  education: ['essay', 'assignment', 'homework', 'research paper', 'university', 'college', 'scholarship'],
  coding: ['python', 'javascript', 'typescript', 'react', 'fastapi', 'debug', 'api', 'sql'],
  writing: ['rewrite', 'tone', 'email', 'blog', 'article', 'copy', 'draft']
}

const MW_STYLE_PATTERNS = {
  concise: ['concise', 'brief', 'short', 'keep it short'],
  step_by_step: ['step-by-step', 'step by step', 'walk me through'],
  examples: ['example', 'sample output', 'show me an example'],
  formal_tone: ['formal', 'professional tone']
}

const MW_DOMAIN_LABELS = {
  career: 'job applications and career growth',
  education: 'school and academic work',
  coding: 'software engineering',
  writing: 'writing and communication'
}

const MW_QUICK_CORRECTION_OPTIONS = [
  { id: 'coding', label: 'Mostly software engineering' },
  { id: 'education', label: 'Mostly school / academics' },
  { id: 'career', label: 'Mostly job search & career' },
  { id: 'writing', label: 'Mostly writing & communication' },
  { id: 'other', label: 'Something else' }
]

const mwRound = (x, places) => Math.round(x * 10 ** places) / 10 ** places
const mwFloat = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
const mwIsObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

/* Same shape as Python's datetime.now(timezone.utc).isoformat(). */
function mwUtcNowIso(now = Date.now()) {
  const iso = new Date(now).toISOString()
  const ms = iso.slice(20, 23)
  return iso.slice(0, 19) + (ms === '000' ? '' : `.${ms}000`) + '+00:00'
}

function mwAsMapping(value) {
  if (mwIsObj(value)) return value
  if (typeof value === 'string' && value.trim()) {
    try { const parsed = JSON.parse(value); if (mwIsObj(parsed)) return parsed } catch (_) {}
  }
  return {}
}

function mwAsList(value) {
  if (Array.isArray(value)) return value
  if (typeof value === 'string' && value.trim()) {
    try { const parsed = JSON.parse(value); if (Array.isArray(parsed)) return parsed } catch (_) {}
  }
  return []
}

function mwNormalizeProfileData(raw) {
  let data = raw
  if (typeof data === 'string') data = mwAsMapping(data)
  if (!mwIsObj(data)) return {}
  const profile = { ...data }
  profile.domains = mwAsMapping(profile.domains)
  profile.preferences = mwAsMapping(profile.preferences)
  profile.active_projects = mwAsList(profile.active_projects)
  profile.confirmed_anchors = mwAsMapping(profile.confirmed_anchors)
  profile.adaptive_weights = mwAsMapping(profile.adaptive_weights)
  profile.quality_metrics = mwAsMapping(profile.quality_metrics)
  profile.constraints = mwAsList(profile.constraints)
  profile.llm_pending_snippets = mwAsList(profile.llm_pending_snippets)
  return profile
}

/* ISO timestamp to ms; naive timestamps are UTC, like _parse_ts. */
function mwParseTs(value) {
  if (!value) return null
  let s = String(value).trim()
  if (/^\d{4}-\d{2}-\d{2}[T ]\d/.test(s) && !/([zZ]|[+-]\d{2}:?\d{2})$/.test(s)) s = s.replace(' ', 'T') + 'Z'
  const t = Date.parse(s)
  return Number.isFinite(t) ? t : null
}

function mwExtractProjects(text) {
  const hits = new Set()
  const patterns = [
    /(?:project|building|working on)\s+([a-z0-9][a-z0-9 _\-]{2,40})/g,
    /(?:for|on)\s+(?:my|the)\s+([a-z0-9][a-z0-9 _\-]{2,40})\s+(?:project|app|tool)/g
  ]
  const lowered = text.toLowerCase()
  for (const pat of patterns) {
    for (const match of lowered.matchAll(pat)) {
      const cleaned = match[1].replace(/\s+/g, ' ').replace(/^[ \-_]+|[ \-_]+$/g, '')
      if (cleaned.length >= 3 && cleaned.length <= 40) hits.add(cleaned)
    }
  }
  return [...hits].sort().slice(0, 4)
}

function mwCountHits(lowered, markers) {
  return markers.reduce((n, m) => n + (lowered.includes(m) ? 1 : 0), 0)
}

function mwInferProfileDelta(existingProfileData, conversationDeltaText, { now = Date.now() } = {}) {
  const profile = mwNormalizeProfileData(existingProfileData)
  const domains = { ...mwAsMapping(profile.domains) }
  const preferences = { ...mwAsMapping(profile.preferences) }
  const activeProjects = [...mwAsList(profile.active_projects)]
  const snippet = String(conversationDeltaText || '').slice(0, MW_MAX_SNIPPET_CHARS)
  const lowered = snippet.toLowerCase()
  const nowIso = mwUtcNowIso(now)

  for (const [domain, keywords] of Object.entries(MW_DOMAIN_PATTERNS)) {
    const hits = mwCountHits(lowered, keywords)
    if (hits <= 0) continue
    const prior = domains[domain] || {}
    const prevConf = mwFloat(prior.confidence)
    const bump = Math.min(0.30, 0.08 * hits)
    const conf = Math.max(prevConf, Math.min(1.0, prevConf * 0.85 + bump))
    domains[domain] = {
      expertise_level: prior.expertise_level || 'unknown',
      confidence: mwRound(conf, 3),
      last_observed_at: nowIso,
      evidence_count: Math.trunc(mwFloat(prior.evidence_count)) + hits
    }
  }

  for (const [prefKey, markers] of Object.entries(MW_STYLE_PATTERNS)) {
    const hits = mwCountHits(lowered, markers)
    if (hits <= 0) continue
    const prior = preferences[prefKey] || {}
    const prevConf = mwFloat(prior.confidence)
    const conf = Math.max(prevConf, Math.min(1.0, prevConf * 0.8 + 0.12 * hits))
    preferences[prefKey] = { value: true, confidence: mwRound(conf, 3), last_observed_at: nowIso }
  }

  const existingMap = new Map(activeProjects.filter(mwIsObj).map((p) => [String(p.name || '').toLowerCase(), p]))
  for (const proj of mwExtractProjects(snippet)) {
    const prior = existingMap.get(proj) || {}
    const prevConf = mwFloat(prior.confidence)
    existingMap.set(proj, {
      name: proj,
      confidence: mwRound(Math.max(prevConf, Math.min(1.0, prevConf * 0.75 + 0.2)), 3),
      last_observed_at: nowIso
    })
  }

  profile.domains = domains
  profile.preferences = preferences
  profile.active_projects = [...existingMap.values()].sort((a, b) => mwFloat(b.confidence) - mwFloat(a.confidence)).slice(0, 8)
  profile.last_observed_at = nowIso
  return profile
}

function mwDecayConfidence(confidence, lastObservedAt, { now = Date.now() } = {}) {
  const ts = mwParseTs(lastObservedAt)
  if (ts === null) return mwFloat(confidence)
  const ageDays = Math.max(0, (now - ts) / MW_DAY_MS)
  const decay = Math.pow(0.5, ageDays / MW_STALE_HALF_LIFE_DAYS)
  return Math.max(0, Math.min(1, mwFloat(confidence) * decay))
}

function mwGetTopDomains(profileData, minConfidence = MW_MIN_DOMAIN_CONFIDENCE, maxDomains = 3, { now = Date.now() } = {}) {
  const data = mwNormalizeProfileData(profileData)
  const ranked = []
  for (const [domain, info] of Object.entries(mwAsMapping(data.domains))) {
    if (!mwIsObj(info)) continue
    const conf = mwDecayConfidence(info.confidence, info.last_observed_at, { now })
    if (conf >= minConfidence) ranked.push([domain, conf])
  }
  ranked.sort((a, b) => b[1] - a[1])
  return ranked.slice(0, maxDomains)
}

function mwComputeSummaryConfidence(profileData, { now = Date.now() } = {}) {
  const data = mwNormalizeProfileData(profileData)
  const llmConf = mwFloat(data.llm_summary_confidence)
  if (llmConf > 0) return mwRound(llmConf, 3)
  const domains = mwGetTopDomains(profileData, 0.25, 4, { now })
  if (!domains.length) return 0
  return mwRound(domains.reduce((s, [, c]) => s + c, 0) / domains.length, 3)
}

function mwBuildInferredSummary(profileData, { now = Date.now() } = {}) {
  const data = mwNormalizeProfileData(profileData)
  const confirmed = mwAsMapping(data.confirmed_anchors)
  if (confirmed.summary) return String(confirmed.summary)
  const llmSummary = String(data.llm_synthesized_summary || '').trim()
  if (llmSummary) return llmSummary
  const labels = mwGetTopDomains(profileData, MW_MIN_DOMAIN_CONFIDENCE, 3, { now })
    .map(([name]) => MW_DOMAIN_LABELS[name] || name.replace(/_/g, ' '))
  if (!labels.length) return 'your AI conversations across different topics'
  if (labels.length === 1) return labels[0]
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`
  return `${labels[0]}, ${labels[1]}, and ${labels[2]}`
}

function mwProfileHasPersonalFacts(profileData) {
  const data = mwNormalizeProfileData(profileData)
  if (['background', 'situation', 'goals'].some((k) => typeof data[k] === 'string' && data[k].trim())) return true
  if (String(data.confirmed_anchors.summary || '').trim()) return true
  if (String(data.llm_synthesized_summary || '').trim()) return true
  const entities = mwAsMapping(data.entities)
  return !!(data.active_projects.length || Object.values(entities).some((v) => mwAsList(v).length))
}

function mwHasEnoughHistory(conversationCount, profileData, { now = Date.now() } = {}) {
  return Math.trunc(mwFloat(conversationCount)) >= MW_MIN_HISTORY_CONVERSATIONS &&
    mwComputeSummaryConfidence(profileData, { now }) >= MW_MIN_SUMMARY_CONFIDENCE
}

function mwShouldPromptConfirmation(profileData, { now = Date.now() } = {}) {
  const data = mwNormalizeProfileData(profileData)
  const confirmed = mwAsMapping(data.confirmed_anchors)
  if (!confirmed.confirmed_at) return true
  const ts = mwParseTs(confirmed.confirmed_at)
  if (ts === null) return true
  if ((now - ts) / MW_DAY_MS >= MW_CONFIRMATION_STALE_DAYS) return true
  const confirmedDomains = new Set(mwAsList(confirmed.domains))
  const inferred = mwGetTopDomains(data, 0.5, 3, { now }).map(([name]) => name)
  if (inferred.length && confirmedDomains.size && !inferred.some((d) => confirmedDomains.has(d))) return true
  return false
}

function mwApplySummaryConfirmation(profileData, action, correctionIds = [], { now = Date.now() } = {}) {
  const profile = mwNormalizeProfileData(profileData)
  const confirmed = { ...mwAsMapping(profile.confirmed_anchors) }
  const nowIso = mwUtcNowIso(now)
  const act = String(action || '').trim().toLowerCase()

  if (act === 'confirm') {
    Object.assign(confirmed, {
      summary: mwBuildInferredSummary(profile, { now }),
      domains: mwGetTopDomains(profile, MW_MIN_DOMAIN_CONFIDENCE, 3, { now }).map(([n]) => n),
      confirmed_at: nowIso,
      source: 'inferred_confirm'
    })
  } else if (act === 'correct') {
    const ids = (correctionIds || []).map((x) => String(x).trim().toLowerCase()).filter(Boolean)
    const labels = MW_QUICK_CORRECTION_OPTIONS.filter((o) => ids.includes(o.id) && o.id !== 'other').map((o) => o.label)
    if (labels.length) {
      const summary = labels.length === 1
        ? labels[0].replace('Mostly ', '').toLowerCase()
        : labels.slice(0, 2).map((l) => l.replace('Mostly ', '').toLowerCase()).join(' and ')
      Object.assign(confirmed, {
        summary,
        domains: ids.filter((i) => i !== 'other'),
        confirmed_at: nowIso,
        source: 'user_correction'
      })
    }
    const domainsMap = { ...mwAsMapping(profile.domains) }
    for (const domainId of ids) {
      if (domainId === 'other') continue
      const prior = domainsMap[domainId] || {}
      domainsMap[domainId] = {
        expertise_level: prior.expertise_level || 'unknown',
        confidence: 1.0,
        last_observed_at: nowIso,
        evidence_count: Math.trunc(mwFloat(prior.evidence_count)) + 1,
        user_verified: true
      }
    }
    profile.domains = domainsMap
  } else if (act === 'skip') {
    confirmed.skipped_at = nowIso
  } else {
    return profile
  }
  profile.confirmed_anchors = confirmed
  profile.last_observed_at = nowIso
  return profile
}

function mwExtractConfirmedAnchorFacts(profileData, { now = Date.now() } = {}) {
  const data = mwNormalizeProfileData(profileData)
  const confirmed = mwAsMapping(data.confirmed_anchors)
  const summary = String(confirmed.summary || '').trim()
  if (!summary) return []
  const facts = [`User-verified focus areas: ${summary}.`]
  for (const key of ['concise', 'step_by_step', 'examples', 'formal_tone']) {
    const pref = mwAsMapping(data.preferences)[key] || {}
    if (!mwIsObj(pref)) continue
    const conf = mwDecayConfidence(pref.confidence, pref.last_observed_at, { now })
    if (pref.value && conf >= MW_MIN_FACT_CONFIDENCE) {
      if (key === 'concise') facts.push('User prefers concise responses (verified pattern).')
      else if (key === 'step_by_step') facts.push('User values step-by-step guidance (verified pattern).')
    }
  }
  return facts.slice(0, 4)
}

function mwExtractRelevantProfileFacts(profileData, query, minConfidence = MW_MIN_FACT_CONFIDENCE, maxFacts = MW_PROFILE_FACT_CAP, { now = Date.now() } = {}) {
  const q = String(query || '').toLowerCase()
  const facts = []
  const data = mwNormalizeProfileData(profileData)

  for (const [domain, info] of Object.entries(mwAsMapping(data.domains))) {
    if (!mwIsObj(info)) continue
    const conf = mwDecayConfidence(info.confidence, info.last_observed_at, { now })
    if (conf < Math.max(minConfidence, MW_MIN_DOMAIN_CONFIDENCE)) continue
    if (q.includes(domain) || (MW_DOMAIN_PATTERNS[domain] || []).some((k) => q.includes(k))) {
      facts.push([conf, `User often asks about ${domain} topics (${Math.trunc(conf * 100)}% confidence).`])
    }
  }

  const prefText = {
    concise: 'User usually prefers concise responses.',
    step_by_step: 'User values step-by-step guidance.',
    examples: 'User often asks for concrete examples.',
    formal_tone: 'User tends to prefer a professional tone.'
  }
  for (const [pref, info] of Object.entries(mwAsMapping(data.preferences))) {
    if (!mwIsObj(info)) continue
    const conf = mwDecayConfidence(info.confidence, info.last_observed_at, { now })
    if (!info.value || conf < minConfidence) continue
    if (prefText[pref]) facts.push([conf, prefText[pref]])
  }

  for (const proj of mwAsList(data.active_projects)) {
    if (!mwIsObj(proj)) continue
    const name = String(proj.name || '').trim()
    const conf = mwDecayConfidence(proj.confidence, proj.last_observed_at, { now })
    if (!name || conf < minConfidence) continue
    const lname = name.toLowerCase()
    if (q.includes(lname) || lname.split(/\s+/).filter(Boolean).some((t) => q.includes(t))) {
      facts.push([conf, `Active project context: ${name}.`])
    }
  }

  facts.sort((a, b) => b[0] - a[0])
  return facts.slice(0, maxFacts).map(([, f]) => f)
}

function mwHybridScoreConversations(conversations, query, profileData, { now = Date.now() } = {}) {
  const q = String(query || '').toLowerCase()
  const data = mwNormalizeProfileData(profileData)
  const projects = mwAsList(data.active_projects).filter(mwIsObj).map((p) => String(p.name || '').toLowerCase())
  const domainWeights = {}
  for (const [name, item] of Object.entries(mwAsMapping(data.domains))) {
    if (!mwIsObj(item)) continue
    domainWeights[name] = mwDecayConfidence(item.confidence, item.last_observed_at, { now })
  }
  const adaptive = mwAsMapping(data.adaptive_weights)
  const recencyBoost = Math.max(0.8, Math.min(1.2, mwFloat(adaptive.retrieval_recency_boost || 1.0) || 1.0))
  const domainBoost = Math.max(0.8, Math.min(1.2, mwFloat(adaptive.retrieval_domain_boost || 1.0) || 1.0))

  const reranked = conversations.map((conv) => {
    const sim = mwFloat(conv.similarity || conv.keyword_score || 0)
    const created = mwParseTs(conv.created_at)
    const ageDays = created !== null ? (now - created) / MW_DAY_MS : 365.0
    const recency = Math.exp(-ageDays / 45.0)
    const text = `${conv.title ?? ''} ${conv.preview ?? ''}`.toLowerCase()
    const projectMatch = projects.some((p) => p && p.length >= 3 && text.includes(p)) ? 1.0 : 0.0
    let domainMatch = 0.0
    for (const [domain, weight] of Object.entries(domainWeights)) {
      if (q.includes(domain) && text.includes(domain)) domainMatch = Math.max(domainMatch, weight)
      else if ((MW_DOMAIN_PATTERNS[domain] || []).some((k) => q.includes(k) && text.includes(k))) domainMatch = Math.max(domainMatch, weight)
    }
    const hybrid = sim * 0.75 + recency * (0.15 * recencyBoost) + domainMatch * (0.07 * domainBoost) + projectMatch * 0.03
    return { ...conv, hybrid_score: mwRound(hybrid, 6), recency_score: mwRound(recency, 6) }
  })
  return reranked.sort((a, b) => (b.hybrid_score || 0) - (a.hybrid_score || 0))
}

function mwApplyEditFeedbackAdaptation(profileData, diffMetrics, acceptedUnedited, { now = Date.now() } = {}) {
  const profile = mwNormalizeProfileData(profileData)
  const adaptive = { ...mwAsMapping(profile.adaptive_weights) }
  const quality = { ...mwAsMapping(profile.quality_metrics) }
  const nowIso = mwUtcNowIso(now)
  const metrics = diffMetrics || {}
  const normDistance = mwFloat(metrics.normalized_edit_distance)
  const promptLen = Math.trunc(mwFloat(metrics.engineered_length))

  const prevTrend = mwFloat(quality.ema_normalized_edit_distance)
  quality.ema_normalized_edit_distance = mwRound(prevTrend * 0.8 + normDistance * 0.2, 6)
  quality.last_feedback_at = nowIso
  const total = Math.trunc(mwFloat(quality.feedback_count)) + 1
  const unedited = Math.trunc(mwFloat(quality.unedited_accept_count)) + (acceptedUnedited ? 1 : 0)
  quality.feedback_count = total
  quality.unedited_accept_count = unedited
  quality.unedited_accept_rate = mwRound(unedited / Math.max(1, total), 6)

  let detail = mwFloat(adaptive.detail_level || 0.5) || 0.5
  if (acceptedUnedited) detail = Math.min(1, detail + 0.03)
  else if (normDistance > 0.35) detail = Math.max(0, detail - 0.05)
  else if (normDistance < 0.12) detail = Math.min(1, detail + 0.02)

  let concise = mwFloat(adaptive.concise_bias || 0.5) || 0.5
  if (promptLen > 900 && normDistance > 0.25) concise = Math.min(1, concise + 0.05)
  else if (promptLen < 400 && normDistance > 0.25) concise = Math.max(0, concise - 0.04)

  let recency = mwFloat(adaptive.retrieval_recency_boost || 1.0) || 1.0
  let domain = mwFloat(adaptive.retrieval_domain_boost || 1.0) || 1.0
  if (acceptedUnedited) {
    recency = Math.min(1.2, recency + 0.01)
    domain = Math.min(1.2, domain + 0.01)
  } else {
    recency = Math.max(0.8, recency - 0.01)
    domain = Math.max(0.8, domain - 0.005)
  }
  adaptive.detail_level = mwRound(detail, 4)
  adaptive.concise_bias = mwRound(concise, 4)
  adaptive.retrieval_recency_boost = mwRound(recency, 4)
  adaptive.retrieval_domain_boost = mwRound(domain, 4)
  adaptive.last_updated_at = nowIso

  profile.adaptive_weights = adaptive
  profile.quality_metrics = quality
  profile.last_observed_at = nowIso
  return profile
}

/* ---- Pure helpers from personalization_llm.py ---------------------------- */

function mwMergeDomainEntry(existing, domainId, incoming, nowIso) {
  const prior = mwIsObj(existing[domainId]) ? existing[domainId] : {}
  const newConf = mwFloat(incoming.confidence)
  const oldConf = mwFloat(prior.confidence)
  return {
    expertise_level: incoming.expertise_level || prior.expertise_level || 'unknown',
    label: incoming.label || prior.label || domainId.replace(/_/g, ' '),
    confidence: mwRound(Math.max(oldConf, Math.min(1, oldConf * 0.7 + newConf * 0.3)), 3),
    last_observed_at: nowIso,
    evidence_count: Math.trunc(mwFloat(prior.evidence_count)) + 1,
    source: 'llm'
  }
}

function mwMergeLlmProfileDelta(existingProfileData, delta, { now = Date.now() } = {}) {
  const profile = mwNormalizeProfileData(existingProfileData)
  const nowIso = mwUtcNowIso(now)
  const d = delta || {}

  const domains = { ...profile.domains }
  for (const [id, info] of Object.entries(mwAsMapping(d.domains))) {
    if (mwIsObj(info)) domains[String(id)] = mwMergeDomainEntry(domains, String(id), info, nowIso)
  }
  profile.domains = domains

  const preferences = { ...profile.preferences }
  for (const [id, info] of Object.entries(mwAsMapping(d.preferences))) {
    if (!mwIsObj(info)) continue
    const prior = mwIsObj(preferences[id]) ? preferences[id] : {}
    const newConf = mwFloat(info.confidence)
    const oldConf = mwFloat(prior.confidence)
    preferences[id] = {
      value: info.value === undefined ? true : !!info.value,
      confidence: mwRound(Math.max(oldConf, Math.min(1, oldConf * 0.7 + newConf * 0.3)), 3),
      last_observed_at: nowIso,
      source: 'llm'
    }
  }
  profile.preferences = preferences

  const projectMap = new Map(
    mwAsList(profile.active_projects).filter((p) => mwIsObj(p) && p.name).map((p) => [String(p.name).toLowerCase(), p])
  )
  for (const item of mwAsList(d.active_projects)) {
    if (!mwIsObj(item)) continue
    const name = String(item.name || '').trim()
    if (!name) continue
    const prior = projectMap.get(name.toLowerCase()) || {}
    const oldConf = mwFloat(prior.confidence)
    const newConf = mwFloat(item.confidence)
    projectMap.set(name.toLowerCase(), {
      name,
      confidence: mwRound(Math.max(oldConf, Math.min(1, oldConf * 0.6 + newConf * 0.4)), 3),
      last_observed_at: nowIso,
      source: 'llm'
    })
  }
  profile.active_projects = [...projectMap.values()].sort((a, b) => mwFloat(b.confidence) - mwFloat(a.confidence)).slice(0, 8)

  const constraints = [...mwAsList(profile.constraints)]
  for (const c of mwAsList(d.constraints)) {
    const text = String(c).trim()
    if (text && !constraints.includes(text)) constraints.push(text)
  }
  profile.constraints = constraints.slice(0, 12)

  const entities = { ...mwAsMapping(profile.entities) }
  for (const [key, val] of Object.entries(mwAsMapping(d.entities))) {
    if (!Array.isArray(val)) continue
    const prior = Array.isArray(entities[key]) ? entities[key] : []
    entities[key] = [...new Set([...prior, ...val.map((v) => String(v).trim()).filter(Boolean)])].slice(0, 20)
  }
  profile.entities = entities

  profile.last_observed_at = nowIso
  profile.last_llm_extract_at = nowIso
  return profile
}

function mwQueueSnippetForLlmExtraction(profileData, snippet) {
  const profile = mwNormalizeProfileData(profileData)
  const pending = [...mwAsList(profile.llm_pending_snippets)]
  const text = String(snippet || '').trim()
  if (text) pending.push(text.slice(0, 2500))
  profile.llm_pending_snippets = pending.slice(-MW_EXTRACTION_BATCH_SIZE * 2)
  return profile
}

function mwShouldRunLlmExtraction(profileData) {
  return mwAsList(mwNormalizeProfileData(profileData).llm_pending_snippets).length >= MW_EXTRACTION_BATCH_SIZE
}

function mwSynthesisIsStale(profileData, { now = Date.now() } = {}) {
  const ts = mwParseTs(mwNormalizeProfileData(profileData).last_llm_synthesis_at)
  if (ts === null) return true
  return (now - ts) / 3600000 >= MW_SYNTHESIS_STALE_HOURS
}

function mwGetDisplaySummary(profileData, { now = Date.now() } = {}) {
  const data = mwNormalizeProfileData(profileData)
  const confirmed = data.confirmed_anchors || {}
  if (confirmed.summary) return String(confirmed.summary)
  const llmSummary = String(data.llm_synthesized_summary || '').trim()
  if (llmSummary) return llmSummary
  return mwBuildInferredSummary(data, { now })
}

function mwGetQuickCorrections(profileData) {
  const custom = mwAsList(mwNormalizeProfileData(profileData).llm_quick_corrections)
  const out = custom
    .filter((c) => mwIsObj(c) && c.label)
    .map((c) => ({ id: String(c.id || String(c.label).toLowerCase().replace(/ /g, '_')), label: String(c.label) }))
  if (out.length) return [...out, { id: 'other', label: 'Something else' }].slice(0, 6)
  return MW_QUICK_CORRECTION_OPTIONS
}

/* Haiku JSON reply to a value; tolerates code fences and trailing prose. */
function mwParseJsonText(text) {
  let cleaned = String(text || '').trim()
  if (cleaned.startsWith('```json')) cleaned = cleaned.slice(7)
  if (cleaned.startsWith('```')) cleaned = cleaned.slice(3)
  if (cleaned.endsWith('```')) cleaned = cleaned.slice(0, -3)
  cleaned = cleaned.trim()
  try {
    return JSON.parse(cleaned)
  } catch (err) {
    const starts = [cleaned.indexOf('{'), cleaned.indexOf('[')].filter((i) => i !== -1)
    if (!starts.length) throw err
    const from = Math.min(...starts)
    const open = cleaned[from]
    const close = open === '{' ? '}' : ']'
    let depth = 0
    let inString = false
    for (let i = from; i < cleaned.length; i++) {
      const ch = cleaned[i]
      if (inString) {
        if (ch === '\\') i++
        else if (ch === '"') inString = false
      } else if (ch === '"') inString = true
      else if (ch === open) depth++
      else if (ch === close && --depth === 0) return JSON.parse(cleaned.slice(from, i + 1))
    }
    throw err
  }
}

/* ---- "About me" drafts (query_intent.py) and memory routing ------------- */

// Unicode-aware \b and \w; JS's are ASCII-only, Python's are not ("résumé").
const MW_WORD = '[\\p{L}\\p{N}_]'
const MW_B = `(?:(?<=${MW_WORD})(?!${MW_WORD})|(?<!${MW_WORD})(?=${MW_WORD}))`

const MW_SELF_DOCS =
  'bio|biography|resume|résumé|cv|cover letter|personal statement|statement of purpose|' +
  'application essay|college essay|admissions? essay|elevator pitch|linkedin (?:about|summary|headline|profile)'
const MW_SOFTWARE = 'parser|code|template|builder|generator|app|website|site|project|script|function|tool|model|api'
const MW_LIFE_TOPICS =
  "school|college|university|uni|masters?|master's|mba|phd|ph\\.d|grad(?:uate)? school|degree|" +
  'major|career|job offer|grad program|phd program|masters program|internship'

const MW_ABOUT_ME = new RegExp([
  `\\b(?:my|an?|the|this|that)\\s+(?:\\w+\\s+)?(?:${MW_SELF_DOCS})\\b(?!\\s+(?:${MW_SOFTWARE}))`,
  '\\babout (?:me|myself)\\b',
  '\\bintroduc(?:e|ing) myself\\b',
  '\\b(?:who am i|what do you know about me|someone like me|people like me)\\b',
  '\\b(?:my|our) (?:own )?(?:background|experiences?|skills|strengths|weaknesses|story|journey|' +
    'qualifications|achievements|accomplishments|career goals|life goals)\\b',
  '\\bshould i (?:pursue|apply|attend|study|major|go (?:back )?to|get an?|do an?|transfer|switch|' +
    `quit|accept|take the)\\b.*\\b(?:${MW_LIFE_TOPICS})\\b`,
  `\\b(?:what|which) (?:${MW_LIFE_TOPICS})\\b.*\\b(?:should i|for me|suits? me|fits? me)\\b`,
  `\\b(?:${MW_LIFE_TOPICS})\\b.*\\b(?:right for me|worth it for me|best for me|a good fit for me)\\b`
].map((p) => `(?:${p})`).join('|').split('\\b').join(MW_B).split('\\w').join(MW_WORD), 'iu')

function mwIsAboutMe(draft) {
  return MW_ABOUT_ME.test(String(draft || '').slice(0, 2000))
}

/* "standard" | "profile" | "rewrite"; see memory_route in retrieval.py. */
function mwMemoryRoute(draft, profile) {
  if (!mwIsAboutMe(draft)) return 'standard'
  const p = profile || {}
  if (p.is_profile_enabled && mwProfileHasPersonalFacts(p.profile_data)) return 'profile'
  return 'rewrite'
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    MW_QUICK_CORRECTION_OPTIONS,
    mwNormalizeProfileData,
    mwParseTs,
    mwInferProfileDelta,
    mwDecayConfidence,
    mwGetTopDomains,
    mwComputeSummaryConfidence,
    mwBuildInferredSummary,
    mwProfileHasPersonalFacts,
    mwHasEnoughHistory,
    mwShouldPromptConfirmation,
    mwApplySummaryConfirmation,
    mwExtractConfirmedAnchorFacts,
    mwExtractRelevantProfileFacts,
    mwHybridScoreConversations,
    mwApplyEditFeedbackAdaptation,
    mwMergeLlmProfileDelta,
    mwQueueSnippetForLlmExtraction,
    mwShouldRunLlmExtraction,
    mwSynthesisIsStale,
    mwGetDisplaySummary,
    mwGetQuickCorrections,
    mwParseJsonText,
    mwIsAboutMe,
    mwMemoryRoute
  }
}
