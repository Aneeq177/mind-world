/* Mind World local memory: shared constants and record shapes.
 *
 * Loaded as a classic script (service worker importScripts, extension pages via
 * <script>) and as a CommonJS module by the Node tests.
 *
 * Records in IndexedDB (database MW_DB_NAME):
 *   conversations  { id, title, source_app, created_at, updated_at, full_text,
 *                    text_hash, num_messages, char_count, preview }
 *   chunks         { id: `${conversation_id}:${chunk_index}`, conversation_id,
 *                    chunk_index, start, end, vector: Float32Array(384), terms: string[] }
 *   profile        { key: 'profile', is_profile_enabled, profile_data }
 *                  profile_data has the same shape as personal_profiles.profile_data
 *   feedback       { id (auto), created_at, ...edit-feedback metrics (no prompt text) }
 *   meta           { key, value }  (schema/model versions, import progress)
 */

const MW_STORAGE_MODE_KEY = 'mw_storage_mode'
const MW_STORAGE_MODES = Object.freeze({ LOCAL: 'local', CLOUD: 'cloud' })

const MW_DB_NAME = 'mind-world-memory'
const MW_DB_VERSION = 1
const MW_STORES = Object.freeze({
  CONVERSATIONS: 'conversations',
  CHUNKS: 'chunks',
  PROFILE: 'profile',
  FEEDBACK: 'feedback',
  META: 'meta'
})

// Bump when chunking or the embedding model changes; chunks indexed under an
// older version are re-embedded in the background.
const MW_INDEX_VERSION = 1
const MW_EMBED_MODEL = 'Xenova/all-MiniLM-L6-v2'
const MW_EMBED_DIM = 384

const MW_EXPORT_FORMAT = 'mind-world-local-export'
const MW_EXPORT_VERSION = 1

const MW_PREVIEW_CHARS = 300

function mwSourceFromPlatform(platform, fallback) {
  const p = String(platform || '').toLowerCase()
  if (p.includes('chatgpt')) return 'chatgpt'
  if (p.includes('gemini')) return 'gemini'
  if (p.includes('perplexity')) return 'perplexity'
  if (p.includes('claude')) return 'claude'
  return fallback || 'claude'
}

/* The auto-save queue item ({id, title, messages, platform, saved_at}) as a
 * Conversation record. Mirrors /save_conversation in backend/main.py. */
function mwConversationFromQueueItem(item) {
  const messages = Array.isArray(item && item.messages) ? item.messages : []
  const parts = []
  for (const msg of messages) {
    const content = msg && msg.content
    if (content) parts.push(`[${msg.role || 'unknown'}] ${content}`)
  }
  const fullText = parts.join('\n\n')
  return {
    id: String((item && item.id) || ''),
    title: (item && item.title) || 'Untitled',
    source_app: mwSourceFromPlatform(item && (item.platform || item.source), item && item.source),
    created_at: (item && item.saved_at) || new Date().toISOString(),
    updated_at: (item && item.saved_at) || new Date().toISOString(),
    num_messages: messages.length,
    char_count: fullText.length,
    preview: fullText.slice(0, MW_PREVIEW_CHARS),
    full_text: fullText
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    MW_STORAGE_MODE_KEY,
    MW_STORAGE_MODES,
    MW_DB_NAME,
    MW_DB_VERSION,
    MW_STORES,
    MW_INDEX_VERSION,
    MW_EMBED_MODEL,
    MW_EMBED_DIM,
    MW_EXPORT_FORMAT,
    MW_EXPORT_VERSION,
    MW_PREVIEW_CHARS,
    mwSourceFromPlatform,
    mwConversationFromQueueItem
  }
}
