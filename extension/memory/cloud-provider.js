/* Cloud memory: today's server-backed behaviour, moved verbatim from
 * background.js. Uses background.js helpers (API_BASE, getAuthContext,
 * getCredentials, getAccessToken, isMemoryEnabled, formatApiErrorDetail). */

const MW_CLIENT_HEADER = 'mwext-f8c3a91d-v3'
// /save_conversation rejects conversation payloads over 100k characters.
const MW_SAVE_PAYLOAD_LIMIT = 95_000
const MW_PROCESS_BATCH = 200

class MwCloudProvider {
  async saveConversation(conversation) {
    // A queue flush saves several conversations; refresh the session once.
    if (!this._saveAuth || Date.now() - this._saveAuth.at > 60_000) {
      const { email } = await getCredentials()
      this._saveAuth = { email, accessToken: await getAccessToken(), at: Date.now() }
    }
    const { email, accessToken } = this._saveAuth
    if (!email || !accessToken) {
      this._saveAuth = null
      return { saved: false, reason: 'auth_required' }
    }
    const res = await fetch(`${API_BASE}/save_conversation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, access_token: accessToken, conversation })
    })
    return { saved: res.ok, id: conversation && conversation.id }
  }

  async search(searchQuery, limit = 5) {
    const auth = await getAuthContext()
    if (auth.error) return { results: [], error: auth.error }
    const response = await fetch(`${API_BASE}/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: searchQuery, email: auth.email, access_token: auth.accessToken, limit })
    })
    if (!response.ok) return { results: [] }
    const data = await response.json()
    return { results: data.results || [] }
  }

  async engineerPrompt({ message, template, conversationIds, skipMemory, platform }) {
    const startedAt = Date.now()
    const auth = await getAuthContext()
    if (auth.error) return { error: auth.error }

    const memoryEnabled = await isMemoryEnabled()
    const stored = await chrome.storage.local.get('mw_device_id')

    const body = {
      email: auth.email,
      access_token: auth.accessToken,
      message,
      template: template || 'none',
      api_key: auth.apiKey || null,
      skip_memory: !!skipMemory || !memoryEnabled,
      device_id: stored.mw_device_id || null,
      platform: platform || null
    }
    if (conversationIds && conversationIds.length > 0) body.conversation_ids = conversationIds

    const response = await fetch(`${API_BASE}/engineer_prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-MW-Client': MW_CLIENT_HEADER },
      body: JSON.stringify(body)
    })
    if (!response.ok) {
      const err = await response.json().catch(() => ({}))
      // quota_exceeded passes through so the UI can show the upgrade CTA.
      return { error: formatApiErrorDetail(err) || 'Engineer prompt failed' }
    }
    const data = await response.json()
    return {
      engineeredPrompt: data.prompt || data.engineered_prompt,
      conversationsUsed: data.conversations_used || 0,
      sourcesUsed: data.sources_used || [],
      memory: data.memory || null,
      latencyMs: Date.now() - startedAt
    }
  }

  async getStats() {
    const auth = await getAuthContext()
    if (auth.error) return { conversationCount: 0, platformCount: 0, error: auth.error }
    const response = await fetch(`${API_BASE}/user_stats`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: auth.email, access_token: auth.accessToken })
    })
    if (!response.ok) return { conversationCount: 0, platformCount: 0 }
    const data = await response.json()
    return {
      conversationCount: data.conversation_count || 0,
      platformCount: data.platform_count || 0,
      sources: data.sources || [],
      consent: {
        consent_at: data.consent_at,
        consent_version: data.consent_version,
        consent_source: data.consent_source,
        consent_event_count: data.consent_event_count
      }
    }
  }

  async getPersonalizationSummary() {
    const auth = await getAuthContext()
    if (auth.error) return { error: auth.error }
    const response = await fetch(`${API_BASE}/personalization_summary`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: auth.email, access_token: auth.accessToken })
    })
    if (!response.ok) {
      const err = await response.json().catch(() => ({}))
      return { error: err.detail || 'Failed to load personalization summary' }
    }
    const data = await response.json()
    return {
      hasEnoughHistory: !!data.has_enough_history,
      shouldShowConfirmation: !!data.should_show_confirmation,
      inferredSummary: data.inferred_summary || '',
      summaryConfidence: data.summary_confidence || 0,
      conversationCount: data.conversation_count || 0,
      quickCorrections: data.quick_corrections || [],
      confirmedSummary: data.confirmed_summary || ''
    }
  }

  async confirmPersonalizationSummary(action, correctionIds) {
    const auth = await getAuthContext()
    if (auth.error) return { error: auth.error }
    const response = await fetch(`${API_BASE}/confirm_personalization_summary`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: auth.email,
        access_token: auth.accessToken,
        action: action || 'skip',
        correction_ids: correctionIds || []
      })
    })
    if (!response.ok) {
      const err = await response.json().catch(() => ({}))
      return { error: err.detail || 'Failed to save personalization summary' }
    }
    const data = await response.json()
    return { success: !!data.success, confirmedSummary: data.confirmed_summary || '' }
  }

  async getProfile() {
    const auth = await getAuthContext()
    if (auth.error) return { error: auth.error }
    const res = await fetch(`${API_BASE}/get_profile_settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: auth.email, access_token: auth.accessToken })
    })
    if (!res.ok) return { error: 'Failed to load profile' }
    const data = await res.json()
    return { is_profile_enabled: !!data.is_profile_enabled, profile_data: data.profile_data || {} }
  }

  async updateProfile({ is_profile_enabled, profile_data }) {
    const auth = await getAuthContext()
    if (auth.error) return { error: auth.error }
    const res = await fetch(`${API_BASE}/update_profile_settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: auth.email, access_token: auth.accessToken, is_profile_enabled: !!is_profile_enabled, profile_data })
    })
    if (!res.ok) return { error: 'Failed to save profile' }
    return { success: true }
  }

  async clearInferredProfile() {
    const auth = await getAuthContext()
    if (auth.error) return { error: auth.error }
    const res = await fetch(`${API_BASE}/clear_inferred_profile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: auth.email, access_token: auth.accessToken })
    })
    if (res.status === 401) {
      await chrome.storage.local.remove(['mw_access_token'])
      return { error: 'Session expired. Add your API key in Advanced Settings and try again.' }
    }
    if (!res.ok) return { error: 'Clear failed' }
    return { success: true }
  }

  async recordEditFeedback(message) {
    const auth = await getAuthContext()
    if (auth.error) return { error: auth.error }
    const response = await fetch(`${API_BASE}/prompt_feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: auth.email,
        access_token: auth.accessToken,
        rating: (typeof message.rating === 'number') ? message.rating : 1,
        event_type: message.eventType || 'rating',
        goal: message.goal || '',
        prompt_preview: message.promptPreview || '',
        template_used: message.templateUsed || '',
        conversations_used: message.conversationsUsed || 0,
        goal_hash: message.goalHash || '',
        engineered_prompt_hash: message.engineeredPromptHash || '',
        final_prompt_hash: message.finalPromptHash || '',
        engineered_prompt_preview: message.engineeredPromptPreview || '',
        final_prompt_preview: message.finalPromptPreview || '',
        diff_metrics: message.diffMetrics || {},
        accepted_unedited: !!message.acceptedUnedited,
        edited: !!message.edited,
        latency_ms: message.latencyMs || null
      })
    })
    if (!response.ok) return { error: 'Failed to log feedback' }
    return { success: true }
  }

  /* The account's server export (/export_data): conversations with full text plus profile. */
  async exportAll() {
    const auth = await getAuthContext()
    if (auth.error) throw new Error(auth.error)
    const res = await fetch(`${API_BASE}/export_data`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: auth.email, access_token: auth.accessToken })
    })
    if (!res.ok) throw new Error(`Export failed (${res.status})`)
    return res.json()
  }

  /* Upload conversations (a local export) to the account. Most go through
   * /save_conversation; ones over its payload limit go as a Claude-format
   * file through /process (stored with source "claude"). */
  async importAll(json, { onProgress } = {}) {
    const conversations = (json && json.conversations) || []
    const auth = await getAuthContext()
    if (auth.error) throw new Error(auth.error)
    let imported = 0
    let keptNewer = 0
    let skipped = 0
    let trimmed = 0
    let done = 0
    const oversized = []
    const report = () => { if (onProgress) onProgress({ done, total: conversations.length }) }
    for (const conv of conversations) {
      const conversation = mwQueueItemFromConversation(conv)
      if (JSON.stringify(conversation).length > MW_SAVE_PAYLOAD_LIMIT) {
        oversized.push(conv)
        continue
      }
      try {
        const res = await fetch(`${API_BASE}/save_conversation`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: auth.email, access_token: auth.accessToken, conversation })
        })
        const data = res.ok ? await res.json().catch(() => ({})) : {}
        if (data.kept_newer) keptNewer++
        else if (data.success) imported++
        else skipped++
      } catch (_) {
        skipped++
      }
      done++
      report()
    }
    for (let i = 0; i < oversized.length; i += MW_PROCESS_BATCH) {
      const batch = oversized.slice(i, i + MW_PROCESS_BATCH)
      try {
        const form = new FormData()
        form.append('email', auth.email)
        form.append('access_token', auth.accessToken)
        form.append('api_key', auth.apiKey || '')
        const file = new Blob([JSON.stringify(mwClaudeExportFromConversations(batch))], { type: 'application/json' })
        form.append('claude_file', file, 'mind-world-local.json')
        const res = await fetch(`${API_BASE}/process`, { method: 'POST', body: form })
        if (!res.ok) throw new Error(`process ${res.status}`)
        const data = await res.json().catch(() => ({}))
        const stored = Math.min(batch.length, Number(data.total || 0))
        const kept = Math.min(stored, Number(data.kept_newer || 0))
        keptNewer += kept
        imported += stored - kept
        skipped += batch.length - stored
      } catch (_) {
        // /process can't map one or two conversations; save each with its
        // text cut to the /save_conversation limit rather than dropping it.
        for (const conv of batch) {
          const outcome = await this._saveTrimmed(auth, conv).catch(() => 'failed')
          if (outcome === 'kept_newer') keptNewer++
          else if (outcome === 'saved') { imported++; trimmed++ } else skipped++
        }
      }
      done += batch.length
      report()
    }
    if (json && json.profile && json.profile.profile_data) {
      await this.updateProfile({
        is_profile_enabled: !!json.profile.is_profile_enabled,
        profile_data: json.profile.profile_data
      }).catch(() => {})
    }
    return { imported, kept_newer: keptNewer, skipped, trimmed }
  }

  async _saveTrimmed(auth, conv) {
    const room = MW_SAVE_PAYLOAD_LIMIT - 2_000
    const conversation = mwQueueItemFromConversation({ ...conv, full_text: String(conv.full_text || '').slice(0, room) })
    while (conversation.messages.length > 1 && JSON.stringify(conversation).length > MW_SAVE_PAYLOAD_LIMIT) {
      conversation.messages.pop()
    }
    const res = await fetch(`${API_BASE}/save_conversation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: auth.email, access_token: auth.accessToken, conversation })
    })
    const data = res.ok ? await res.json().catch(() => ({})) : {}
    if (data.kept_newer) return 'kept_newer'
    return data.success ? 'saved' : 'failed'
  }

  async deleteAllMemory() {
    const auth = await getAuthContext()
    if (auth.error) throw new Error(auth.error)
    const res = await fetch(`${API_BASE}/clear_cloud_memory`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: auth.email, access_token: auth.accessToken })
    })
    if (!res.ok) throw new Error(`Clearing cloud memory failed (${res.status})`)
    return { deleted: true }
  }
}
